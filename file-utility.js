Components.utils.import("resource://gre/modules/FileUtils.jsm");

var FileUtility = {
	initialized: false,
	addedElementIDs: [],

	/**
	 * Initializes the FileUtility module.
	 * This includes overriding certain Zotero functions, registering notifiers, and marking the module as initialized.
	 */
	init() {
		if (this.initialized) return;
		this.initialized = true;

		this.overrideFileRename();
		this.overrideRenameAttachmentFile();
		this.overrideSetAutoAttachmentTitle();
		this.registerNotifier();

		this.log('Initialized');
	},

	/**
	 * Logs a prefixed debug message.
	 * @param {string} msg - The message to log.
	 */
	log(msg) {
		Zotero.debug('File Utility: ' + msg);
	},


	/**
 * Adds the plugin and its functionality to a specified Zotero window.
 *
 * @param {Window} window - The Zotero window to which the plugin should be added.
 *
 * This function adds a new menu item, "Convert to Linked File, under the Tools -> manage attachments menu in the specified Zotero window. 
 * The menu allows users to trigger the convert to linked file process. The function includes error handling and 
 * detailed logging to ensure robustness and easier debugging.
 */
	addToWindow(window) {
		let doc = window.document;

		// Use Fluent for localization
		window.MozXULElement.insertFTLIfNeeded("file-utility.ftl");

		// Locate the target menu in Tools -> Manage Attachments
		let manageAttachmentsMenu = doc.getElementById('manage-attachments-menupopup');
		if (!manageAttachmentsMenu) {
			this.log('Could not find manage-attachments-menupopup element');
			return;
		}

		// Add menu option in Tools -> Manage Attachments
		let convertToLinkedFileMenuItem = doc.createXULElement('menuitem');
		convertToLinkedFileMenuItem.id = 'file-utility-convert-to-linked-file';
		convertToLinkedFileMenuItem.setAttribute('data-l10n-id', 'file-menuitem-convert-to-linked');
		convertToLinkedFileMenuItem.addEventListener('command', () => {
			FileUtility.convertAttachmentsToLinkedFiles();
		});
		manageAttachmentsMenu.appendChild(convertToLinkedFileMenuItem);
		this.storeAddedElement(convertToLinkedFileMenuItem);

		this.log('Added Convert to Linked File menu item');
	},

	/**
	 * Adds this plugins functionality to all open Zotero windows.
	 *
	 * This function iterates through all currently open Zotero windows and, if the window contains a `ZoteroPane`, 
	 * applies the plugin functionality by calling `this.addToWindow(win)`. This function is useful for ensuring 
	 * that all open Zotero windows are equipped with the necessary related features when the plugin is initialized or updated.
	 */
	addToAllWindows() {
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.addToWindow(win);
		}
	},

	/**
 * Stores the ID of an added DOM element.
 *
 * @param {Element} elem - The DOM element to store. The element must have a unique `id` attribute.
 * @throws {Error} If the element does not have an `id` attribute.
 *
 * This function is used to track elements that have been dynamically added to the DOM by storing their IDs in 
 * `this.addedElementIDs`. It is crucial for managing these elements later, particularly for cleanup operations.
 */
	storeAddedElement(elem) {
		if (!elem.id) {
			throw new Error("Element must have an id");
		}
		this.addedElementIDs.push(elem.id);
	},

	/**
 * Removes this plugin functionality from a specific Zotero window.
 *
 * @param {Window} window - The Zotero window from which to remove the plugins elements.
 *
 * This function removes all dynamically added elements from the specified Zotero window by using the IDs stored 
 * in `this.addedElementIDs`. It also removes the any localization resource files from the window's DOM. 
 * This function is useful for cleaning up related elements when the plugin is being disabled or uninstalled.
 */
	removeFromWindow(window) {
		var doc = window.document;
		// Remove all elements added to DOM
		for (let id of this.addedElementIDs) {
			doc.getElementById(id)?.remove();
		}
		doc.querySelector('[href="file-utility.ftl"]').remove();
	},

	/**
 * Removes this plugin functionality from all open Zotero windows.
 *
 * This function iterates through all currently open Zotero windows and, if the window contains a `ZoteroPane`, 
 * calls `this.removeFromWindow(win)` to remove all plugin-related elements from each window. This function is typically 
 * used during the cleanup process when the plugin is being disabled or uninstalled.
 */
	removeFromAllWindows() {
		var windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	},

	/**
	 * Converts selected Zotero attachments to linked files.
	 * This function handles file path construction, file moving, and linking within Zotero.
	 */
	async convertAttachmentsToLinkedFiles() {
		try {
			let selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
			let collection = Zotero.getActiveZoteroPane().getSelectedCollection();
			this.log('Selected items: ' + JSON.stringify(selectedItems.map(item => item.id)));

			let baseDir = Zotero.Prefs.get('extensions.zotero.baseAttachmentPath', true);
			this.log('Base directory: ' + baseDir);

			if (!baseDir) {
				this.log('Linked attachment base directory is not set.');
				throw new Error('Linked attachment base directory is not set.');
			}

			// Determine the correct path separator
			let pathSeparator = Zotero.isWin ? '\\' : '/';

			// Ensure the baseDir ends with a path separator
			if (!baseDir.endsWith(pathSeparator)) {
				baseDir += pathSeparator;
			}

			// Get the collection path for the selected collection
			let collectionPath = await this._getCollectionPath(collection, pathSeparator);
			this.log('Collection path: ' + collectionPath);

			for (let item of selectedItems) {
				await this._processItem(item, baseDir, collectionPath, pathSeparator);
			}

			this.log('Conversion to linked files completed successfully.');
		} catch (error) {
			this.log('Error converting attachments to linked files: ' + error.message);
		}
	},

	/**
	 * Processes a Zotero item, converting attachments to linked files.
	 * This function handles both direct attachments and child items.
	 * 
	 * @param {Object} item - The Zotero item to process.
	 * @param {string} baseDir - The base directory for linked files.
	 * @param {string} collectionPath - The path of the current collection.
	 * @param {string} pathSeparator - The path separator based on the OS.
	 */
	async _processItem(item, baseDir, collectionPath, pathSeparator) {
		if (item.isAttachment()) {
			this.log('Processing direct attachment: ' + item.id);
			await this._convertAttachmentToLinkedFile(item, baseDir, collectionPath, pathSeparator);
		} else if (item.isRegularItem()) {
			this.log('Processing regular item: ' + item.id);

			// Fetch child items (attachments) of the current item
			let childItems = await Zotero.Items.getAsync(item.getAttachments());
			this.log('Found ' + childItems.length + ' child items for parent item ' + item.id);

			for (let childItem of childItems) {
				this.log('Processing child item: ' + childItem.id + ' of type ' + childItem.itemType);

				if (childItem.isAttachment()) {
					this.log('Child item ' + childItem.id + ' is an attachment.');
					await this._convertAttachmentToLinkedFile(childItem, baseDir, collectionPath, pathSeparator);
				} else if (childItem.isRegularItem()) {
					this.log('Recursively processing regular child item: ' + childItem.id);
					await this._processItem(childItem, baseDir, collectionPath, pathSeparator);
				} else {
					this.log('Skipping non-regular, non-attachment child item: ' + childItem.id);
				}
			}
		} else {
			this.log('Skipping non-regular, non-attachment item: ' + item.id);
		}
	},

	/**
	 * Converts a single Zotero attachment to a linked file.
	 * Handles file movement, renaming, and linking within Zotero.
	 * 
	 * @param {Object} item - The Zotero attachment item to convert.
	 * @param {string} baseDir - The base directory for linked files.
	 * @param {string} collectionPath - The path of the current collection.
	 * @param {string} pathSeparator - The path separator based on the OS.
	 */
	async _convertAttachmentToLinkedFile(item, baseDir, collectionPath, pathSeparator) {
		try {
			let fileExists = await item.fileExists();
			if (!fileExists) {
				this.log('File for item ID ' + item.id + ' does not exist, skipping.');
				return;
			}

			let file = await item.getFilePathAsync();
			this.log('File path for item ID ' + item.id + ': ' + file);
			if (!file) {
				this.log('No file path found for item ID ' + item.id);
				return;
			}

			// Construct the linked file path
			let filename = file.split(Zotero.isWin ? '\\' : '/').pop(); // Extract the filename from the original path
			this.log('Extracted filename: ' + filename);
			let linkedFilePath = baseDir + collectionPath + pathSeparator + filename;

			// Check if the file already exists and rename if necessary
			let newFile = Zotero.File.pathToFile(linkedFilePath);
			let counter = 1;
			while (newFile.exists()) {
				let fileParts = filename.split('.');
				let baseName = fileParts.slice(0, -1).join('.');
				let extension = fileParts.pop();
				let newFilename = `${baseName} (${counter}).${extension}`;
				linkedFilePath = baseDir + collectionPath + pathSeparator + newFilename;
				newFile = Zotero.File.pathToFile(linkedFilePath);
				counter++;
			}

			this.log('Constructed and checked linked file path: ' + linkedFilePath);

			// Move the file to the new location using nsIFile methods
			let originalFile = Zotero.File.pathToFile(file);
			this.log('Original file nsIFile object: ' + originalFile.path);

			// Ensure the directory exists
			let parentDir = newFile.parent;
			this.log('Parent directory: ' + parentDir.path);
			if (!parentDir.exists()) {
				this.log('Parent directory does not exist, creating...');
				parentDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
			}

			// Move the file to the new location
			originalFile.moveTo(parentDir, newFile.leafName);
			this.log('File moved to new location');

			// Link the file in Zotero
			await Zotero.Attachments.linkFromFile({
				file: newFile,
				parentItemID: item.parentItemID,
				libraryID: item.libraryID,
			});

			this.log('Linked file from path: ' + linkedFilePath);

			// Erase the Zotero item itself
			await item.eraseTx();
			this.log('Zotero item erased');
		} catch (error) {
			this.log('Error converting attachment: ' + error.message);
		}
	},

	/**
	 * Constructs the collection path for a given Zotero collection.
	 * This involves mapping collections and traversing the collection tree to build the path.
	 * 
	 * @param {Object} collection - The Zotero collection to process.
	 * @param {string} pathSeparator - The path separator based on the OS.
	 * @returns {string} - The constructed collection path.
	 */
	async _getCollectionPath(collection, pathSeparator) {
		this.log('Starting to build collection path...');

		let collectionPath = '';
		let collectionDirs = [];
		let currentCollectionKey = collection.key;

		// Initialize the collections map and tree
		let collectionsMap = {};
		let collectionsTree = {};

		// Recursive function to map all collections and their subcollections
		const mapCollections = async (col, parentKey = null) => {
			this.log('Mapping collection: ' + col.name + ' (Key: ' + col.key + ')');
			collectionsMap[col.key] = col;

			// Add to tree structure
			if (!collectionsTree[parentKey]) {
				collectionsTree[parentKey] = [];
			}
			collectionsTree[parentKey].push(col.key);

			// Recursively map all child collections
			let childCollections = await Zotero.Collections.getAsync(col.getChildCollections(true, false));
			for (let childCol of childCollections) {
				await mapCollections(childCol, col.key);
			}
		};

		// Get the root collections in the library
		let rootCollections = Zotero.Collections.getByLibrary(collection.libraryID, false);
		this.log('Total root collections retrieved: ' + rootCollections.length);

		// Map all collections starting from root
		for (let rootCol of rootCollections) {
			await mapCollections(rootCol);
		}

		// Traverse the tree to build the path
		const traverseTree = (key) => {
			let collection = collectionsMap[key];
			if (collection) {
				let collectionName = collection.name.replace(/[\\/:*?"<>|]/g, '');
				this.log('Adding to path: ' + collectionName + ' (Key: ' + key + ')');
				collectionDirs.unshift(collectionName);

				// Find the parent key
				for (let parentKey in collectionsTree) {
					if (collectionsTree[parentKey].includes(key)) {
						traverseTree(parentKey);
						break;
					}
				}
			}
		};

		// Start traversal from the current collection
		traverseTree(currentCollectionKey);

		// Join the collection directories with the path separator
		collectionPath = collectionDirs.join(pathSeparator);
		this.log('Final constructed collection path: ' + collectionPath);

		return collectionPath;
	},

	/**
 * Overrides the default Zotero file renaming function to track renamed files.
 */
overrideFileRename() {
	const originalRename = Zotero.File.rename;

	Zotero.File.rename = async function (filePath, newName, options = {}) {
		// Convert the file path string to a FileUtils.File object
		let file = new FileUtils.File(filePath);
		let originalName = file.leafName;
		Zotero.debug('Original file name:', originalName);

		// Call the original rename function
		Zotero.debug('Attempting to rename file:', filePath, 'to:', newName);
		let result = await originalRename.apply(this, arguments);

		// Track the file path and name regardless of whether the rename was successful
		let newFilePath = file.parent;
		newFilePath.append(result || originalName);  // Use the original name if the rename was not successful
		Zotero.debug('New file path:', newFilePath.path);

		// Store the new file path for comparison in the observer
		FileUtility.lastRenamedFilePath = newFilePath.path;
		FileUtility.lastNewFilename = result || originalName;  // Use the original name if the rename was not successful
		Zotero.debug('Stored last renamed file path:', FileUtility.lastRenamedFilePath);
		Zotero.debug('Stored last new filename:', FileUtility.lastNewFilename);

		return result;
	};

	Zotero.debug('Zotero.File.rename method overridden');
},

overrideRenameAttachmentFile() {
    // Ensure Zotero and the target function exist
    if (typeof Zotero !== 'undefined' && Zotero.Item && Zotero.Item.prototype.renameAttachmentFile) {

        // Store the original function in a variable
        const originalRenameAttachmentFile = Zotero.Item.prototype.renameAttachmentFile;

        // Create the wrapper function
        Zotero.Item.prototype.renameAttachmentFile = async function(newName, overwrite = false, unique = false) {
            let origPath = await this.getFilePathAsync();
            if (!origPath) {
                Zotero.debug("Attachment file not found in renameAttachmentFile()", 2);
                return false;
            }

            let origName = PathUtils.filename(origPath);
            let result;

            // No change in filename, but we still want to trigger item modification
            if (origName === newName) {
                Zotero.debug("Filename has not changed, but custom logic will still be executed.");

                // Custom logic for when the filename hasn't changed
                await this.relinkAttachmentFile(origPath);  // Ensure the file is correctly linked

                // Trigger item modification manually (if needed)
                this.setField('title', this.getField('title')); // Force a "modify" event by setting the title to itself
                await this.saveTx();

                // Set the last renamed file path and name (for notify function logic)
                FileUtility.lastRenamedFilePath = origPath;
                FileUtility.lastNewFilename = newName;

                return true; // Return true to indicate completion
            }

            // Call the original renameAttachmentFile function for actual renaming
            result = await originalRenameAttachmentFile.apply(this, arguments);

            // Custom post-rename logic
            if (result === true) {
                FileUtility.lastRenamedFilePath = OS.Path.join(PathUtils.parent(origPath), newName);
                FileUtility.lastNewFilename = newName;
            }

            return result;
        };

        Zotero.debug('Zotero.Item.prototype.renameAttachmentFile overridden with custom logic');
    }
},

	/**
	 * Overrides the default Zotero function for setting automatic attachment titles.
	 * This function synchronizes attachment titles with filenames if the relevant preference is enabled.
	 */
	overrideSetAutoAttachmentTitle() {
		const originalSetAutoAttachmentTitle = Zotero.Item.prototype.setAutoAttachmentTitle;

		Zotero.Item.prototype.setAutoAttachmentTitle = function ({ ignoreAutoRenamePrefs } = {}) {
			// Check if the sync-filename-and-title preference is enabled
			let syncFilenameAndTitle = Zotero.Prefs.get('extensions.file-utility.sync-filename-and-title', true);
			Zotero.debug(`Preference 'extensions.file-utility.sync-filename-and-title' is set to: ${syncFilenameAndTitle}`);

			if (syncFilenameAndTitle) {
				Zotero.debug('Bypassing setAutoAttachmentTitle due to preference setting');

				// Manually synchronize the title with the filename
				let filename = this.attachmentFilename;
				if (filename) {
					let title = filename.replace(/\.[^.]+$/, '');
					this.setField('title', title);
					Zotero.debug(`Title manually set to: ${title}`);
					this.saveTx(); // Save changes to the item
				}

				return;
			}

			// Otherwise, proceed with the original logic
			return originalSetAutoAttachmentTitle.apply(this, arguments);
		};

		this.log('Zotero.Item.prototype.setAutoAttachmentTitle method overridden');
	},

	/**
	 * Registers a notifier to observe item modifications in Zotero.
	 */
	registerNotifier() {
		Zotero.Notifier.registerObserver(this, ['item'], 'modify');
		this.log('Notifier registered for item modifications');
	},

	/**
	 * Notifies the observer of modifications to Zotero items.
	 * If an item's filename has changed, this function updates the item's title accordingly.
	 * 
	 * @param {string} event - The type of event (e.g., "modify").
	 * @param {string} type - The type of object being observed (e.g., "item").
	 * @param {Array<number>} ids - The IDs of the modified items.
	 * @param {Object} extraData - Additional data related to the event.
	 */
	notify(event, type, ids, extraData) {
		if ((type === 'item' && event === 'modify') || (type === 'item' && event === 'refresh')) {
			Zotero.debug('notify triggered with event:', event, 'type:', type, 'ids:', ids);
		
			for (let id of ids) {
				let item = Zotero.Items.get(id);
				if (item.isAttachment()) {
					let currentPath = item.getFilePath();
					Zotero.debug('Processing item with id:', id);
					Zotero.debug('Current file path:', currentPath);
		
					// Always execute if the filename differs from the title
					let title = item.getField('title');
					let filename = currentPath.split(/(\\|\/)/g).pop();
					Zotero.debug('Item title:', title);
					Zotero.debug('Extracted filename:', filename);
		
					// Check if this modification matches the last renamed file or if the filename differs from the title
					if (currentPath === FileUtility.lastRenamedFilePath || filename !== title) {
						Zotero.debug('Filename differs from title or matches last renamed file path. Handling filename change.');
						FileUtility.handleFilenameChange(item, filename);
					} else {
						Zotero.debug('No filename change necessary.');
					}
				} else {
					Zotero.debug('Item is not an attachment, skipping.');
				}
			}
		} else {
			Zotero.debug(`Event type or event is not "item" and "modify/refresh", skipping. Event: ${event}, Type: ${type}`);
		}
	},
	

	/**
	 * Handles the change of an attachment's filename by updating its title.
	 * 
	 * @param {Object} item - The Zotero item whose filename has changed.
	 * @param {string} newFilename - The new filename to which the item's title should be updated.
	 */
	async handleFilenameChange(item, newFilename) {
		this.log(`Filename changed to: ${newFilename}`);

		// Check if the preference is enabled
		let syncFilenameAndTitle = Zotero.Prefs.get('extensions.file-utility.sync-filename-and-title', true);
		this.log(`Preference 'extensions.file-utility.sync-filename-and-title' is set to: ${syncFilenameAndTitle}`);

		if (syncFilenameAndTitle) {
			let title = newFilename.replace(/\.[^/.]+$/, ""); // Remove the file extension
			item.setField('title', title);

			// Save the changes to the item
			await item.saveTx();

			this.log(`Title updated to match filename: ${title}`);
		}
	},

	/**
	 * The main function of the FileUtility module.
	 * This function adds the "Convert to Linked File" menu item to all Zotero windows and logs the action.
	 */
	async main() {
		this.addToAllWindows();
		this.log('Main function executed');
	}
};
