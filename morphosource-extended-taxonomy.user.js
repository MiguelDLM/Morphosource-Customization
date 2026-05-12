// ==UserScript==
// @name         MorphoSource Extended Taxonomy (GBIF + PBDB)
// @namespace    https://www.morphosource.org/
// @version      0.7
// @description  Show extinction status (†) using GBIF + Paleobiology Database on MorphoSource
// @author       Miguel
// @match        https://www.morphosource.org/catalog/media*
// @grant        GM_xmlhttpRequest
// @connect      api.gbif.org
// @connect      paleobiodb.org
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    console.log('[MS-GBIF] v0.7 loaded');

    const GBIF_MATCH   = 'https://api.gbif.org/v1/species/match';
    const GBIF_SPECIES = 'https://api.gbif.org/v1/species';
    const GBIF_OCC     = 'https://api.gbif.org/v1/occurrence/count';
    const PBDB_TAXON   = 'https://paleobiodb.org/api1.2/taxa/single.json';
    const CACHE = new Map();

    // ── HTTP helper ──────────────────────────────────────────────────────────
    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload(r) {
                    try {
                        resolve({
                            ok: r.status >= 200 && r.status < 300,
                            json: () => Promise.resolve(JSON.parse(r.responseText))
                        });
                    } catch(e) { reject(e); }
                },
                onerror: reject,
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }

    // ── Name cleaning ────────────────────────────────────────────────────────
    // "Ursus Linnaeus sp."         → "Ursus"
    // "Puma Jardine Puma concolor" → "Puma concolor"
    // "Canis sp."                  → "Canis"
    function cleanTaxonName(raw) {
        let s = raw.trim();
        s = s.replace(/\s+spps?\.?\s*$/i, '').replace(/\s+sp\.?\s*$/i, '').trim();
        const words = s.split(/\s+/).filter(Boolean);
        if (words.length === 0) return '';
        if (words.length === 1) return words[0];
        if (words.length === 2) return /^[a-z]/.test(words[1]) ? s : words[0];
        const last = words[words.length - 1];
        if (/^[a-z]/.test(last)) {
            for (let i = words.length - 2; i >= 0; i--) {
                if (/^[A-Z]/.test(words[i])) return `${words[i]} ${last}`;
            }
        }
        return words[0];
    }

    function selectBestNames(rawNames) {
        const cleaned = [...new Set(rawNames.map(cleanTaxonName).filter(n => n.length > 1))];
        const binomials = cleaned.filter(n => /\s/.test(n));
        const genera    = cleaned.filter(n => !/\s/.test(n));
        if (binomials.length === 0) return genera;
        const covered = new Set(binomials.map(b => b.split(' ')[0].toLowerCase()));
        return [...binomials, ...genera.filter(g => !covered.has(g.toLowerCase()))];
    }

    // ── GBIF occurrence count (extant/fossil signal) ─────────────────────────
    // basisOfRecord: 'HUMAN_OBSERVATION' → recent sightings (species is alive)
    //                'FOSSIL_SPECIMEN'   → fossil records
    async function occurrenceCount(taxonKey, basisOfRecord) {
        try {
            const resp = await gmFetch(`${GBIF_OCC}?taxonKey=${taxonKey}&basisOfRecord=${basisOfRecord}`);
            if (!resp.ok) return 0;
            const n = await resp.json();
            return typeof n === 'number' ? n : 0;
        } catch(e) { return 0; }
    }

    // ── PBDB lookup ──────────────────────────────────────────────────────────
    // Returns true (fossil/extinct), false (extant), or null (not found).
    // Primarily useful for fossil taxa; living species may not be in PBDB.
    async function fetchPbdb(name) {
        console.log(`[MS-GBIF] PBDB querying "${name}"`);
        try {
            const resp = await gmFetch(`${PBDB_TAXON}?name=${encodeURIComponent(name)}&show=attr`);
            if (!resp.ok) { console.log(`[MS-GBIF] PBDB HTTP ${resp.status} for "${name}"`); return null; }
            const data = await resp.json();
            const rec = data.records && data.records[0];
            if (!rec) { console.log(`[MS-GBIF] PBDB no records for "${name}"`); return null; }
            console.log(`[MS-GBIF] PBDB "${name}" → is_extant=${rec.is_extant} nam=${rec.nam}`);
            if (rec.is_extant === 'no')  return true;
            if (rec.is_extant === 'yes') return false;
            return null;
        } catch(e) {
            console.warn(`[MS-GBIF] PBDB error for "${name}":`, e);
            return null;
        }
    }

    // ── Combined extinct/extant determination ────────────────────────────────
    // Returns { extinct: true|false|null, source: string }
    async function determineStatus(name, usageKey) {
        // 1. PBDB — authoritative for fossil taxa
        const pbdb = await fetchPbdb(name);
        if (pbdb !== null) return { extinct: pbdb, source: 'pbdb' };

        if (!usageKey) return { extinct: null, source: 'none' };

        // 2. GBIF occurrence counts — works for both living and extinct taxa
        const [humanObs, fossilRecs] = await Promise.all([
            occurrenceCount(usageKey, 'HUMAN_OBSERVATION'),
            occurrenceCount(usageKey, 'FOSSIL_SPECIMEN')
        ]);
        console.log(`[MS-GBIF] occurrences "${name}" → human=${humanObs} fossil=${fossilRecs}`);

        if (humanObs > 10) return { extinct: false, source: 'gbif-obs' };   // clearly alive
        if (fossilRecs > 0 && humanObs === 0) return { extinct: true, source: 'gbif-fossil' }; // only fossil record

        return { extinct: null, source: 'none' };
    }

    // ── GBIF match + species details ─────────────────────────────────────────
    async function fetchInfo(name) {
        const key = name.toLowerCase().trim();
        if (CACHE.has(key)) return CACHE.get(key);

        let result = null;
        try {
            const mResp = await gmFetch(`${GBIF_MATCH}?name=${encodeURIComponent(name)}&verbose=false`);
            if (!mResp.ok) { CACHE.set(key, null); return null; }
            const m = await mResp.json();
            if (m.matchType === 'NONE') { CACHE.set(key, null); return null; }

            result = {
                extinct: typeof m.extinct === 'boolean' ? m.extinct : null,
                iucn:    null,
                family:  m.family || null,
                order:   m.order  || null,
                source:  'gbif-backbone'
            };

            const usageKey = m.usageKey || m.speciesKey || m.acceptedUsageKey;

            if (usageKey) {
                const sResp = await gmFetch(`${GBIF_SPECIES}/${usageKey}`);
                if (sResp.ok) {
                    const s = await sResp.json();
                    if (typeof s.extinct === 'boolean') result.extinct = s.extinct;
                    result.iucn   = s.iucnRedListCategory || null;
                    result.family = result.family || s.family || null;
                    result.order  = result.order  || s.order  || null;
                }
            }

            // If backbone doesn't have extinction status, use PBDB + occurrence counts
            if (result.extinct === null) {
                const status = await determineStatus(name, usageKey);
                if (status.extinct !== null) {
                    result.extinct = status.extinct;
                    result.source  = status.source;
                }
            }

            console.log(`[MS-GBIF] "${name}" → extinct=${result.extinct} source=${result.source} iucn=${result.iucn} family=${result.family}`);
        } catch(e) {
            console.error('[MS-GBIF] error:', name, e);
        }

        CACHE.set(key, result);
        return result;
    }

    // ── Badge rendering ──────────────────────────────────────────────────────
    // † for extinct (any source), IUCN badge for living if available,
    // small "viv" badge for confirmed-living with no IUCN data.
    const IUCN_ABBREV = {
        EXTINCT:               'EX',  EXTINCT_IN_THE_WILD:   'EW',
        CRITICALLY_ENDANGERED: 'CR',  ENDANGERED:            'EN',
        VULNERABLE:            'VU',  NEAR_THREATENED:       'NT',
        LEAST_CONCERN:         'LC',
    };

    function makeBadge(result) {
        const isExtinct = result.extinct === true
            || result.iucn === 'EXTINCT'
            || result.iucn === 'EXTINCT_IN_THE_WILD';

        if (isExtinct) {
            const el = document.createElement('span');
            el.className = 'ms-gbif-badge';
            el.textContent = '†';
            el.title = `Extinto (${result.source || 'GBIF/PBDB'})`;
            el.style.cssText = 'font-style:normal;font-weight:bold;margin-left:4px;cursor:help;vertical-align:middle;font-size:1em;';
            return el;
        }

        if (result.extinct === false) {
            const iucnAbbrev = result.iucn && IUCN_ABBREV[result.iucn];
            const label = iucnAbbrev && iucnAbbrev !== 'EX' && iucnAbbrev !== 'EW'
                ? iucnAbbrev
                : 'viv';
            const titleText = result.iucn
                ? `IUCN: ${result.iucn.replace(/_/g, ' ')} (${result.source})`
                : `Viviente (${result.source})`;
            const el = document.createElement('span');
            el.className = 'ms-gbif-badge';
            el.textContent = label;
            el.title = titleText;
            el.style.cssText = [
                'font-style:normal', 'font-size:0.7em', 'font-weight:bold',
                'margin-left:5px', 'vertical-align:middle',
                'border:1px solid currentColor', 'border-radius:2px',
                'padding:0 2px', 'cursor:help', 'letter-spacing:0.02em',
                'opacity:0.7'
            ].join(';');
            return el;
        }

        return null; // status unknown — show nothing
    }

    // ── DOM helpers ──────────────────────────────────────────────────────────
    function attachBadge(el, result) {
        if (el.querySelector('.ms-gbif-badge')) return;
        const badge = makeBadge(result);
        if (badge) el.appendChild(badge);
    }

    function injectRows(dd, info) {
        if (dd.dataset.msRowsDone) return;
        const pairs = [];
        if (info.family) pairs.push(['Family (GBIF)', info.family]);
        if (info.order)  pairs.push(['Order (GBIF)',  info.order]);
        if (pairs.length === 0) return;
        dd.dataset.msRowsDone = '1';

        let anchor = dd;
        for (const [label, val] of pairs) {
            if (anchor.parentNode.querySelector(`[data-ms-label="${label}"]`)) continue;
            const newDt = document.createElement('dt');
            newDt.textContent = `${label}:`;
            newDt.dataset.msLabel = label;
            newDt.className = (dd.previousElementSibling?.className || '') + ' ms-gbif-row';
            const newDd = document.createElement('dd');
            newDd.textContent = val;
            newDd.className = (dd.className || '') + ' ms-gbif-row';
            anchor.parentNode.insertBefore(newDt, anchor.nextSibling);
            anchor.parentNode.insertBefore(newDd, newDt.nextSibling);
            anchor = newDd;
        }
    }

    // ── Per-entry processing ─────────────────────────────────────────────────
    async function processEntry(dt) {
        if (dt.dataset.msGbifDone) return;
        dt.dataset.msGbifDone = '1';

        const dd = dt.nextElementSibling;
        if (!dd || dd.tagName !== 'DD') return;

        const italicEls = Array.from(dd.querySelectorAll('i'));
        const rawNames = italicEls.length > 0
            ? italicEls.map(el => el.textContent.trim()).filter(n => n.length > 1)
            : [dd.textContent.trim().split(/[\n,;]/)[0].trim()].filter(n => n.length > 1);

        const names = selectBestNames(rawNames);
        console.log('[MS-GBIF] raw:', rawNames, '→ querying:', names);

        let bestResult = null;
        for (const name of names) {
            const info = await fetchInfo(name);
            if (!info) continue;

            const matchingIdx = rawNames.findIndex(r => cleanTaxonName(r) === name);
            const targetEl = matchingIdx >= 0 && italicEls[matchingIdx]
                ? italicEls[matchingIdx]
                : dd;

            attachBadge(targetEl, info);

            if (!bestResult || (!bestResult.family && info.family) || (!bestResult.order && info.order)) {
                bestResult = info;
            }
        }

        if (bestResult) injectRows(dd, bestResult);
    }

    // ── Main scan ────────────────────────────────────────────────────────────
    async function processAll() {
        const dts = Array.from(document.querySelectorAll('dt:not([data-ms-gbif-done])')).filter(dt =>
            /taxon|taxonomy|scientific\s*name/i.test(dt.textContent)
        );
        console.log(`[MS-GBIF] scan: ${dts.length} unprocessed taxonomy dt(s)`);
        for (const dt of dts) await processEntry(dt);
    }

    let timer = null;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(processAll, 600);
    }).observe(document.body, { childList: true, subtree: true });

    setTimeout(processAll, 800);
})();
