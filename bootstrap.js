var FileUtility;

/**
 * Logs a debug message prefixed with "File Utility:".
 * @param {string} msg - The message to log.
 */
function log(msg) {
    Zotero.debug("File Utility: " + msg);
}

/**
 * Called when the plugin is installed.
 * Logs the installation event.
 */
function install() {
    log("Installed");
}

/**
 * Called when the plugin is started.
 * Registers the plugin's preference pane, loads the main script, 
 * initializes the FileUtility object, and calls its main function.
 *
 * @param {Object} options - Startup options.
 * @param {string} options.id - The ID of the plugin.
 * @param {string} options.version - The version of the plugin.
 * @param {string} options.rootURI - The root URI of the plugin.
 */
async function startup({ id, version, rootURI }) {
    log("Starting");

    // Register the plugin's preference pane
    Zotero.PreferencePanes.register({
        image: 'chrome/skin/default/file-utility/icon.svg',
        pluginID: 'file-utility@example.com',
        src: rootURI + 'prefs.xhtml'
    });

    // Load the main script
    Services.scriptloader.loadSubScript(rootURI + 'file-utility.js');

    // Initialize and run the FileUtility object
    FileUtility.init({ id, version, rootURI });
    await FileUtility.main();
}

/**
 * Called when the Zotero main window is loaded.
 * Adds the File Utility functionality to the loaded window.
 * 
 * @param {Object} options - Load options.
 * @param {Window} options.window - The Zotero main window that was loaded.
 */
function onMainWindowLoad({ window }) {
    FileUtility.addToWindow(window);
}

/**
 * Called when the Zotero main window is unloaded.
 * Removes the File Utility functionality from the unloaded window.
 * 
 * @param {Object} options - Unload options.
 * @param {Window} options.window - The Zotero main window that was unloaded.
 */
function onMainWindowUnload({ window }) {
    FileUtility.removeFromWindow(window);
}

/**
 * Called when the plugin is shut down.
 * Removes the File Utility functionality from all windows and clears the FileUtility object.
 */
function shutdown() {
    log("Shutting down");
    FileUtility.removeFromAllWindows();
    FileUtility = undefined;
}

/**
 * Called when the plugin is uninstalled.
 * Logs the uninstallation event.
 */
function uninstall() {
    log("Uninstalled");
}
