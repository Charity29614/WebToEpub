/*
    Main processing handler for popup.html

*/
var main = (function() {
    "use strict";

    // this will be called when message listener fires
    function onMessageListener(message, sender, sendResponse) {  // eslint-disable-line no-unused-vars
        if (message.messageType == "ParseResults") {
            chrome.runtime.onMessage.removeListener(onMessageListener);
            util.log("addListener");
            util.log(message);
            // convert the string returned from content script back into a DOM
            let dom = new DOMParser().parseFromString(message.document, "text/html");
            populateControlsWithDom(message.url, dom);
        }
    }

    // details 
    let initialWebPage = null;
    let parser = null;
    let userPreferences = null;
    let library = new Library; 

    // register listener that is invoked when script injected into HTML sends its results
    function addMessageListener() {
        try {
            // note, this will throw if not running as an extension.
            if (!chrome.runtime.onMessage.hasListener(onMessageListener)) {
                chrome.runtime.onMessage.addListener(onMessageListener);
            }
        } catch (chromeError) {
            util.log(chromeError);
        }
    }

    // extract urls from DOM and populate control
    async function processInitialHtml(url, dom) {
        if (setParser(url, dom)) {
            try {
                userPreferences.addObserver(parser);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
                return;
            }
            try {
                await parser.loadEpubMetaInfo(dom);
                let metaInfo = parser.getEpubMetaInfo(dom, userPreferences.useFullTitle.value);
                populateMetaInfo(metaInfo);
                setUiToDefaultState();
                parser.populateUI(dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
            try {
                await parser.onLoadFirstPage(url, dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
        }
    }

    function setUiToDefaultState() {
        document.getElementById("highestResolutionImagesRow").hidden = true;
        document.getElementById("unSuperScriptAlternateTranslations").hidden = true; 
        document.getElementById("imageSection").hidden = true;
        document.getElementById("outputSection").hidden = false;
        document.getElementById("translatorRow").hidden = true;
        document.getElementById("fileAuthorAsRow").hidden = true;
        document.getElementById("defaultParserSection").hidden = true;
    }

    function populateMetaInfo(metaInfo) {
        setUiFieldToValue("startingUrlInput", metaInfo.uuid);
        setUiFieldToValue("titleInput", metaInfo.title);
        setUiFieldToValue("authorInput", metaInfo.author);
        setUiFieldToValue("languageInput", metaInfo.language);
        setUiFieldToValue("fileNameInput", metaInfo.fileName);
        setUiFieldToValue("subjectInput", metaInfo.subject);
        setUiFieldToValue("descriptionInput", metaInfo.description);
        setUiFieldToValue("publisherInput", metaInfo.publisher);
        if (metaInfo.seriesName !== null) {
            document.getElementById("seriesRow").hidden = false;
            document.getElementById("volumeRow").hidden = false;
            setUiFieldToValue("seriesNameInput", metaInfo.seriesName);
            setUiFieldToValue("seriesIndexInput", metaInfo.seriesIndex);
        }

        setUiFieldToValue("translatorInput", metaInfo.translator);
        setUiFieldToValue("fileAuthorAsInput", metaInfo.fileAuthorAs);
    }

    function setUiFieldToValue(elementId, value) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            element.value = (value == null) ? "" : value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    function metaInfoFromControls() {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = getValueFromUiField("startingUrlInput");
        let baseTitle = getValueFromUiField("titleInput");
        let rangeStart = document.getElementById("selectRangeStartChapter");
        let rangeEnd = document.getElementById("selectRangeEndChapter");

        function extractChapterNum(selectEl, fallbackIndex) {
            if (!selectEl || selectEl.selectedIndex < 0 || !selectEl.options[selectEl.selectedIndex]) {
                return String(fallbackIndex + 1);
            }
            let label = selectEl.options[selectEl.selectedIndex].text;
            let m = label.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
            return m ? m[1] : String(fallbackIndex + 1);
        }

        let startLabel = rangeStart ? extractChapterNum(rangeStart, rangeStart.selectedIndex) : "1";
        let endLabel = rangeEnd ? extractChapterNum(rangeEnd, rangeEnd.selectedIndex) : "";
        metaInfo.title = endLabel ? `${startLabel}-${endLabel} ${baseTitle}` : baseTitle;
        metaInfo.author = getValueFromUiField("authorInput");
        metaInfo.language = getValueFromUiField("languageInput");
        metaInfo.fileName = getValueFromUiField("fileNameInput");
        metaInfo.subject = getValueFromUiField("subjectInput");
        metaInfo.description = getValueFromUiField("descriptionInput");
        metaInfo.publisher = getValueFromUiField("publisherInput");

        if (document.getElementById("seriesRow").hidden === false) {
            metaInfo.seriesName = getValueFromUiField("seriesNameInput");
            metaInfo.seriesIndex = getValueFromUiField("seriesIndexInput");
        }

        metaInfo.translator = getValueFromUiField("translatorInput");
        metaInfo.fileAuthorAs = getValueFromUiField("fileAuthorAsInput");
        metaInfo.styleSheet = userPreferences.styleSheet.value;

        return metaInfo;
    }

    function getValueFromUiField(elementId) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            return (element.value === "") ? null : element.value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    // The 4 "pack" buttons that kick off a fetch+pack run.  All of them
    // are greyed out together whenever any one of them is clicked, and
    // re-enabled together once the fetch+pack work has finished.
    function getAllPackButtons() {
        return [
            getPackEpubButton(),
            document.getElementById("packFirst10ChaptersButton"),
            document.getElementById("packFirst50ChaptersButton"),
            document.getElementById("packFirst100ChaptersButton"),
        ];
    }

    function setPackButtonsDisabled(disabled) {
        getAllPackButtons().forEach(b => b.disabled = disabled);
    }

    async function fetchContentAndPackEpub() {
        let libclick = this;
        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
            setUiFieldToValue("publisherInput", "");
        }
        let metaInfo = metaInfoFromControls();

        if ("yes" == libclick.dataset.libclick) {
            if (document.getElementById("chaptersPageInChapterListCheckbox").checked) {
                ErrorLog.showErrorMessage(UIText.Error.errorAddToLibraryLibraryAddPageWithChapters);
                return;
            }
        }

        console.log(`[web2epub] fetchContentAndPackEpub: maxChaptersPerEpub=${userPreferences.maxChaptersPerEpub.value}, first10Silent=${window.first10Silent}`);
        let rowsBeforeLimit = ChapterUrlsUI.getTableRowsWithChapters();
        let checkedBeforeLimit = rowsBeforeLimit.filter(r => r.querySelector("input[type='checkbox']").checked).length;
        console.log(`[web2epub] before limitNumOfChapterS: total rows=${rowsBeforeLimit.length}, checked=${checkedBeforeLimit}`);
        ChapterUrlsUI.limitNumOfChapterS(userPreferences.maxChaptersPerEpub.value, window.first10Silent === true);
        let rowsAfterLimit = ChapterUrlsUI.getTableRowsWithChapters();
        let checkedAfterLimit = rowsAfterLimit.filter(r => r.querySelector("input[type='checkbox']").checked).length;
        console.log(`[web2epub] after limitNumOfChapterS: total rows=${rowsAfterLimit.length}, checked=${checkedAfterLimit}`);
        ChapterUrlsUI.resetDownloadStateImages();
        ErrorLog.clearHistory();
        window.workInProgress = true;
        setPackButtonsDisabled(true);
        replaceLibAddToLibrary();
        parser.onStartCollecting();
        console.log(`[web2epub] starting parser.fetchContent()...`);
        await parser.fetchContent();
        console.log(`[web2epub] parser.fetchContent() completed`);
        // Set workInProgress=false HERE (after fetch, before pack+save)
        // so the polling loop in fetchContentAndPackFirstNChapters can exit.
        // packEpub and Download.save can hang on Kiwi/Android if the save
        // dialog doesn't resolve, which previously trapped the flag forever.
        window.workInProgress = false;
        console.log(`[web2epub] workInProgress cleared, starting packEpub...`);
        let content = await packEpub(metaInfo);
        console.log(`[web2epub] packEpub completed`);
        setPackButtonsDisabled(false);
        replaceLibAddToLibrary();
        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let fileName = Download.CustomFilename();
        if ("yes" == libclick.dataset.libclick || util.sleepController.signal.aborted) {
            await library.LibAddToLibrary(content, fileName, document.getElementById("startingUrlInput").value, overwriteExisting, backgroundDownload);
        } else {
            await Download.save(content, fileName, overwriteExisting, backgroundDownload);
        }
        try {
            parser.updateReadingList();
            if (util.sleepController.signal.aborted) {
                util.sleepController = new AbortController;
                resetUI();
            }
            if (libclick.dataset.libsuppressErrorLog == true) {
                return;
            } else {
                ErrorLog.showLogToUser();
                dumpErrorLogToFile();
            }
        } catch (err) {
            window.workInProgress = false;
            setPackButtonsDisabled(false);
            if (util.sleepController.signal.aborted) {
                util.sleepController = new AbortController;
            }
            replaceLibAddToLibrary();
            ErrorLog.showErrorMessage(err);
        }
    }

    async function fetchContentAndPackFirstNChapters(n) {
        console.log(`[web2epub] fetchContentAndPackFirstNChapters called with n=${n}`);
        setPackButtonsDisabled(true);
        let original = userPreferences.maxChaptersPerEpub.value;
        console.log(`[web2epub] original maxChaptersPerEpub=${original}`);
        userPreferences.maxChaptersPerEpub.value = String(n);
        window.first10Silent = true;
        let rangeEnd = document.getElementById("selectRangeEndChapter");
        let originalEndIndex = rangeEnd.selectedIndex;
        console.log(`[web2epub] rangeEnd.length=${rangeEnd.length}, originalEndIndex=${originalEndIndex}`);
        rangeEnd.selectedIndex = Math.min(n - 1, rangeEnd.length - 1);
        console.log(`[web2epub] rangeEnd.selectedIndex set to ${rangeEnd.selectedIndex} (min of n-1=${n-1} and rangeEnd.length-1=${rangeEnd.length-1})`);

        // Remember which chapters were checked/enabled for parsing before
        // we hand off to fetchContentAndPackEpub(), which (via
        // ChapterUrlsUI.limitNumOfChapterS()) will uncheck everything past
        // the first n chapters.
        let allRows = ChapterUrlsUI.getTableRowsWithChapters();
        console.log(`[web2epub] total chapter rows in table: ${allRows.length}`);
        let savedChapterSelection = allRows.map(row => ({
            row: row,
            checked: row.querySelector("input[type='checkbox']").checked,
        }));
        let checkedCount = savedChapterSelection.filter(x => x.checked).length;
        console.log(`[web2epub] chapters checked before limit: ${checkedCount}`);

        // Don't await the full fetchContentAndPackEpub() promise chain to
        // re-enable these buttons: if the user cancels the native "Save As"
        // dialog, that promise can hang indefinitely (a known quirk of the
        // downloads API), which would leave these buttons disabled forever.
        // Instead, restore everything as soon as the fetch/pack work itself
        // (tracked by window.workInProgress) is done, regardless of what
        // happens with the save dialog afterwards.
        let restoreState = () => {
            console.log(`[web2epub] restoreState called — restoring maxChaptersPerEpub to ${original}`);
            userPreferences.maxChaptersPerEpub.value = original;
            window.first10Silent = false;
            rangeEnd.selectedIndex = originalEndIndex;
            // Restore each chapter's checked state to what it was before
            // this button was clicked.
            savedChapterSelection.forEach(({row, checked}) => ChapterUrlsUI.setRowCheckboxState(row, checked));
            setPackButtonsDisabled(false);
        };
        let restored = false;
        let restoreOnce = () => {
            if (!restored) {
                restored = true;
                restoreState();
            }
        };

        window.workInProgress = true;
        console.log(`[web2epub] about to call fetchContentAndPackEpub, window.workInProgress=${window.workInProgress}`);
        let packPromise = fetchContentAndPackEpub.call(document.getElementById("packEpubButton"));
        packPromise.then(restoreOnce).catch(restoreOnce);

        // Poll for workInProgress flipping back to false (fetch/pack done,
        // save dialog about to show or already showing) so the buttons come
        // back even if the save dialog promise never settles.
        // We pre-set window.workInProgress = true above so the loop doesn't
        // exit immediately before fetchContentAndPackEpub() gets to run.
        let pollCount = 0;
        while (window.workInProgress === true) {
            await new Promise(resolve => setTimeout(resolve, 100));
            pollCount++;
            if (pollCount % 20 === 0) {
                console.log(`[web2epub] still polling... ${pollCount * 100}ms elapsed, workInProgress=${window.workInProgress}`);
            }
        }
        console.log(`[web2epub] polling ended after ${pollCount * 100}ms, workInProgress=${window.workInProgress}`);
        restoreOnce();
    }

    function replaceLibAddToLibrary() {
        let el = document.getElementById("LibAddToLibrary");
        el.hidden = !el.hidden;
        el = document.getElementById("LibPauseToLibrary");
        el.hidden = !el.hidden;
    }

    function pauseToLibrary() {
        util.sleepController.abort();
    }

    function epubVersionFromPreferences() {
        return userPreferences.createEpub3.value ? 
            EpubPacker.EPUB_VERSION_3 : EpubPacker.EPUB_VERSION_2;
    }

    function packEpub(metaInfo) {
        let epubVersion = epubVersionFromPreferences();
        let epub = new EpubPacker(metaInfo, epubVersion);
        ProgressBar.startPackingPhase();
        let onProgress = (done, total) => ProgressBar.setPackingProgress(done, total);
        return epub.assemble(parser.epubItemSupplier(), onProgress).finally(() => {
            ProgressBar.endPackingPhase();
        });
    }

    function dumpErrorLogToFile() {
        let errors = ErrorLog.dumpHistory();
        if (userPreferences.writeErrorHistoryToFile.value &&
            !util.isNullOrEmpty(errors)) {
            let fileName = metaInfoFromControls().fileName + ".ErrorLog.txt";
            let blob = new Blob([errors], {type : "text"});
            return Download.save(blob, fileName)
                .catch (err => ErrorLog.showErrorMessage(err));
        }
    }

    function getActiveTabDOM(tabId) {
        addMessageListener();
        injectContentScript(tabId);
    }

    function injectContentScript(tabId) {
        if (util.isFirefox()) {
            Firefox.injectContentScript(tabId);
        } else {
            chromeInjectContentScript(tabId);
        }
    }

    function chromeInjectContentScript(tabId) {
        try {
            chrome.scripting.executeScript({
                target: {tabId: tabId},
                files: ["js/ContentScript.js"]
            });
        } catch {
            if (chrome.runtime.lastError) {
                util.log(chrome.runtime.lastError.message);
            }
        }
    }

    function populateControls() {
        loadUserPreferences();
        parserFactory.populateManualParserSelectionTag(getManuallySelectParserTag());
        configureForTabMode();
    }

    function loadUserPreferences() {
        userPreferences = UserPreferences.readFromLocalStorage();
        userPreferences.addObserver(library);
        userPreferences.writeToUi();
        userPreferences.hookupUi();
        BakaTsukiSeriesPageParser.registerBakaParsers(userPreferences.autoSelectBTSeriesPage.value);
    }

    function isRunningInTabMode() {
        // if query string supplied, we're running in Tab mode.
        let search = window.location.search;
        return !util.isNullOrEmpty(search);
    }

    async function populateControlsWithDom(url, dom) {
        initialWebPage = dom;
        setUiFieldToValue("startingUrlInput", url);

        // set the base tag, in case server did not supply it 
        util.setBaseTag(url, initialWebPage);
        await processInitialHtml(url, initialWebPage);
        if (document.getElementById("autosearchmetadataCheckbox").checked == true) {
            await autosearchadditionalmetadata();
        }
    }

    function setParser(url, dom) {
        let manualSelect = getManuallySelectParserTag().value;
        if (util.isNullOrEmpty(manualSelect)) {
            parser = parserFactory.fetch(url, dom);
        } else {
            parser = parserFactory.manuallySelectParser(manualSelect);
        }
        if (parser === undefined) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return false;
        }
        getLoadAndAnalyseButton().hidden = true;
        let disabledMessage = parser.disabled();
        if (disabledMessage !== null) {
            ErrorLog.showErrorMessage(disabledMessage);
            return false;
        }
        return true;
    }

    // called when the "Diagnostics" check box is ticked or unticked
    function onDiagnosticsClick() {
        let enable = document.getElementById("diagnosticsCheckBoxInput").checked;
        document.getElementById("reloadButton").hidden = !enable;
    }

    function onAdvancedOptionsClick() {
        let section =  getAdvancedOptionsSection();
        section.hidden = !section.hidden;
        section = getAdditionalMetadataSection();
        section.hidden = !userPreferences.ShowMoreMetadataOptions.value;
        section =  getLibrarySection();
        section.hidden = true;
    }

    function onShowMoreMetadataOptionsClick() {
        let section = getAdditionalMetadataSection();
        section.hidden = !section.hidden;
    }

    function onLibraryClick() {
        let section =  getLibrarySection();
        section.hidden = !section.hidden;
        if (!section.hidden) {
            Library.LibRenderSavedEpubs();
        }
        section =  getAdvancedOptionsSection();
        section.hidden = true;
    }

    function onStylesheetToDefaultClick() {
        document.getElementById("stylesheetInput").value = EpubMetaInfo.getDefaultStyleSheet();
        userPreferences.readFromUi();
    }

    async function openTabWindow() {
        // open new tab window, passing ID of open tab with content to convert to epub as query parameter.
        let tabId = await getActiveTab();
        let url = chrome.runtime.getURL("popup.html") + "?id=";
        url += tabId;
        try {
            chrome.tabs.create({ url: url, openerTabId: tabId });
        }
        catch (err) {
            //firefox android catch
            chrome.tabs.create({ url: url});
        }
        window.close();
    }

    function getActiveTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
                if ((tabs != null) && (0 < tabs.length)) {
                    resolve(tabs[0].id);
                } else {
                    reject();
                }
            });
        });
    }

    async function onLoadAndAnalyseButtonClick() {
        // load page via XmlHTTPRequest
        let url = getValueFromUiField("startingUrlInput");
        getLoadAndAnalyseButton().disabled = true;
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await populateControlsWithDom(url, xhr.responseXML);
            getLoadAndAnalyseButton().disabled = false;
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    function configureForTabMode() {
        getActiveTabDOM(extractTabIdFromQueryParameter());
    }

    function extractTabIdFromQueryParameter() {
        let windowId = window.location.search.split("=")[1];
        if (!util.isNullOrEmpty(windowId)) {
            return parseInt(windowId, 10);
        }
    }

    function getPackEpubButton() {
        return document.getElementById("packEpubButton");
    }

    function getLoadAndAnalyseButton() {
        return document.getElementById("loadAndAnalyseButton");
    }

    function resetUI() {
        initialWebPage = null;
        parser = null;
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = "";
        populateMetaInfo(metaInfo);
        getLoadAndAnalyseButton().hidden = false;
        main.getPackEpubButton().disabled = false;
        document.getElementById("LibAddToLibrary").disabled = false;
        document.getElementById("LibAddToLibrary").hidden = false;
        document.getElementById("LibPauseToLibrary").hidden = true;
        ChapterUrlsUI.clearChapterUrlsTable();
        CoverImageUI.clearUI();
        ProgressBar.setValue(0);
        // Clear the selected value so it doesn't look like a parser is selected
        document.getElementById("manuallySelectParserTag").selectedIndex = -1;
    }

    function localizeHtmlPage() {
        // can't use a single select, because there are buttons in td elements
        for (let selector of ["button, option", "td, th", ".i18n"]) {
            for (let element of [...document.querySelectorAll(selector)]) {
                if (element.textContent.startsWith("__MSG_")) {
                    UIText.localizeElement(element);
                }
            }
        }
    }

    function clearCoverUrl() {
        CoverImageUI.setCoverImageUrl(null);
    }

    function getManuallySelectParserTag() {
        return document.getElementById("manuallySelectParserTag");
    }

    function getAdditionalMetadataSection() {
        return document.getElementById("AdditionalMetadatatable");
    }

    function getAdvancedOptionsSection() {
        return document.getElementById("advancedOptionsSection");
    }

    function getLibrarySection() {
        return document.getElementById("hiddenBibSection");
    }

    function onSeriesPageHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#using-baka-tsuki-series-page-parser" });
    }

    function onCustomFilenameHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/Advanced-Options#custom-filename" });
    }

    function onDefaultParserHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#how-to-convert-a-new-site-using-the-default-parser" });
    }

    function onReadOptionsFromFile(event) {
        userPreferences.readFromFile(event, populateControls);
    }

    function onReadingListCheckboxClicked() {
        let url = parser.state.chapterListUrl;
        let checked = UserPreferences.getReadingListCheckbox().checked;
        userPreferences.readingList.onReadingListCheckboxClicked(checked, url);
    }

    function sbFiltersShow()
    {
        sbShow();
        ChapterUrlsUI.Filters.init();
        document.getElementById("sbFilters").hidden = false;
        
        let filtersForm = document.getElementById("sbFiltersForm");
        util.removeElements(filtersForm.children);
        filtersForm.appendChild(ChapterUrlsUI.Filters.generateFiltersTable());
        ChapterUrlsUI.Filters.Filter(); //Run reset filters to clear confusion.
    }

    function sbShow() {
        document.getElementById("sbOptions").classList.add("sidebarOpen");
    }

    function sbHide() {
        document.getElementById("sbOptions").classList.remove("sidebarOpen");
        document.getElementById("sbFilters").hidden = true;
    }

    function showReadingList() {
        let sections = new Map(
            [...document.querySelectorAll("section")]
                .map(s =>[s, s.hidden])
        );
        [...sections.keys()].forEach(s => s.hidden = true);

        document.getElementById("readingListSection").hidden = false;
        document.getElementById("closeReadingList").onclick = () => {
            [...sections].forEach(s => s[0].hidden = s[1]);
        };

        let table = document.getElementById("readingListTable");
        userPreferences.readingList.showReadingList(table);
        table.onclick = (event) => userPreferences.readingList.onClickRemove(event);
    }

    /**
     * If work in progress, give user chance to cancel closing the window
     */
    function onUnloadEvent(event) {
        if (window.workInProgress === true) {
            event.preventDefault();
            event.returnValue = "";
        } else {
            delete event["returnValue"];
        }
    }

    function addEventHandlers() {
        getPackEpubButton().onclick = fetchContentAndPackEpub;
        document.getElementById("packFirst10ChaptersButton").addEventListener("click", () => fetchContentAndPackFirstNChapters(5));
        document.getElementById("packFirst50ChaptersButton").addEventListener("click", () => fetchContentAndPackFirstNChapters(10));
        document.getElementById("packFirst100ChaptersButton").addEventListener("click", () => fetchContentAndPackFirstNChapters(50));
        document.getElementById("diagnosticsCheckBoxInput").onclick = onDiagnosticsClick;
        document.getElementById("reloadButton").onclick = populateControls;
        getManuallySelectParserTag().onchange = populateControls;
        document.getElementById("advancedOptionsButton").onclick = onAdvancedOptionsClick;
        document.getElementById("hiddenBibButton").onclick = onLibraryClick;
        document.getElementById("ShowMoreMetadataOptionsCheckbox").addEventListener("change", () => onShowMoreMetadataOptionsClick());
        document.getElementById("LibShowAdvancedOptionsCheckbox").addEventListener("change", () => Library.LibRenderSavedEpubs());
        document.getElementById("LibAddToLibrary").addEventListener("click", fetchContentAndPackEpub);
        document.getElementById("LibPauseToLibrary").addEventListener("click", pauseToLibrary);
        document.getElementById("stylesheetToDefaultButton").onclick = onStylesheetToDefaultClick;
        document.getElementById("resetButton").onclick = resetUI;
        document.getElementById("clearCoverImageUrlButton").onclick = clearCoverUrl;
        document.getElementById("seriesPageHelpButton").onclick = onSeriesPageHelp;
        document.getElementById("CustomFilenameHelpButton").onclick = onCustomFilenameHelp;
        document.getElementById("defaultParserHelpButton").onclick = onDefaultParserHelp;
        getLoadAndAnalyseButton().onclick = onLoadAndAnalyseButtonClick;
        document.getElementById("loadMetadataButton").onclick = onLoadMetadataButtonClick;

        document.getElementById("writeOptionsButton").onclick = () => userPreferences.writeToFile();
        document.getElementById("readOptionsInput").onchange = onReadOptionsFromFile;
        UserPreferences.getReadingListCheckbox().onclick = onReadingListCheckboxClicked;
        document.getElementById("viewFiltersButton").onclick = () => sbFiltersShow();
        document.getElementById("sbClose").onclick = () => sbHide();
        document.getElementById("viewReadingListButton").onclick = () => showReadingList();
        window.addEventListener("beforeunload", onUnloadEvent);
    }
	
	
    // Additional metadata
    async function autosearchadditionalmetadata() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let titlename = getValueFromUiField("titleInput");
        let url ="https://www.novelupdates.com/series-finder/?sf=1&sh="+titlename;
        if (getValueFromUiField("subjectInput")==null) {
            await autosearchnovelupdates(url, titlename);
        }   
        getPackEpubButton().disabled = false; 
        document.getElementById("LibAddToLibrary").disabled = false;    
    }
	
    async function autosearchnovelupdates(url, titlename) {
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await findnovelupdatesurl(url, xhr.responseXML, titlename);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    async function findnovelupdatesurl(url, dom, titlename) {
        try {    
            let searchurl = [...dom.querySelectorAll("a")].filter(a => a.textContent==titlename)[0];
            setUiFieldToValue("metadataUrlInput", searchurl.href);
            url = getValueFromUiField("metadataUrlInput");
            if (url.includes("novelupdates.com") == true) {
                await onLoadMetadataButtonClick();
            }
        } catch {
            //
        }
    }
	
    async function onLoadMetadataButtonClick() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let url = getValueFromUiField("metadataUrlInput");
        try {
            let xhr = await HttpClient.wrapFetch(url);
            populateMetadataAddWithDom(url, xhr.responseXML);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    function populateMetadataAddWithDom(url, dom) {
        try {
            let allTags = document.getElementById("lesstagsCheckbox").checked == false;
            let metaAddInfo = EpubMetaInfo.getEpubMetaAddInfo(dom, url, allTags);
            setUiFieldToValue("subjectInput", metaAddInfo.subject);
            setUiFieldToValue("descriptionInput", metaAddInfo.description);
            if (getValueFromUiField("authorInput")=="<unknown>") {
                setUiFieldToValue("authorInput", metaAddInfo.author);
            }
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        } catch (error) {
            ErrorLog.showErrorMessage(error);
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        }
    }

    // actions to do when window opened
    window.onload = async () => {
        userPreferences = UserPreferences.readFromLocalStorage();
        if (isRunningInTabMode()) { 
            ErrorLog.SuppressErrorLog =  false;
            localizeHtmlPage();
            getAdvancedOptionsSection().hidden = !userPreferences.advancedOptionsVisibleByDefault.value;
            getAdditionalMetadataSection().hidden = !userPreferences.ShowMoreMetadataOptions.value;
            addEventHandlers();
            populateControls();
            if (util.isFirefox()) {
                Firefox.startWebRequestListeners();
            }
        } else {
            await openTabWindow();
        }
    };

    return {
        getPackEpubButton: getPackEpubButton,
        onLoadAndAnalyseButtonClick : onLoadAndAnalyseButtonClick,
        fetchContentAndPackEpub: fetchContentAndPackEpub,
        resetUI: resetUI,
        getCurrentParser: () => parser,
        getUserPreferences: () => userPreferences,
    };
})();