# Morphosource Customization

Repository containing user scripts to customize and enhance the user experience on Morphosource (https://www.morphosource.org).

These scripts are intended to be installed in the browser using extensions such as Tampermonkey, Greasemonkey, or Violentmonkey. Below you'll find the repository purpose and a high-level description of each included script.

## Repository purpose

Provide small, focused UserScripts that add useful features and UI improvements to Morphosource, aimed at researchers and power users who need more convenient filtering, exploration, or navigation of collections and taxonomies.

## Included scripts

- `morphosource-advanced-search.user.js`
  - Purpose: Extend and improve search functionality within Morphosource.
  - Functionality (summary): Adds advanced filters, search modifiers, and/or shortcuts to help locate items using more precise criteria 

- `morphosource-extended-taxonomy.user.js`
  - Purpose: Enhance taxonomy information and navigation on Morphosource.
  - Functionality (summary): Improves visualization and exploration of the taxonomic hierarchy by adding direct links, shortcuts to filter by taxonomic rank (class, order, family)

Note: The descriptions above are high-level. For exact details about what each script changes on the page (which elements are modified, the added shortcuts, or exact filters), check the headers and comments at the top of each `*.user.js` file.

## Installation

1. Install a UserScript manager in your browser (e.g. Tampermonkey, Greasemonkey, or Violentmonkey).
2. Open the `*.user.js` file from this repository in your editor or copy its content to a new script in the extension.
3. Enable the script and reload Morphosource.

## Basic usage

- For `morphosource-advanced-search.user.js`: Perform searches on Morphosource as usual and look for the additional panel or controls on the search page. 
- For `morphosource-extended-taxonomy.user.js`: Visit taxonomy pages or collection listings and inspect the enhanced taxonomic tree and added links/controls.

## Contributing

If you'd like to improve these scripts or add new features:

1. Open an issue describing the improvement or bug.
2. Submit a pull request with clear changes, tests when possible, and a description of the new behavior.

## License

This repository is licensed under the Apache-2.0 License. 

## Contact

For questions or inquiries, open an issue in this repository 

---

Files in this repository:

```
morphosource-advanced-search.user.js
morphosource-extended-taxonomy.user.js
```

Thanks for improving the Morphosource experience. If you like, I can extract the header comments from each script and add more precise usage examples to this README.
