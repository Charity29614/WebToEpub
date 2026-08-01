
"use strict";

/**
   Code to manipulate the Progress Bar on the UI 
*/
class ProgressBar { // eslint-disable-line no-unused-vars
    constructor() {
    }

    static getUiElement() {
        return document.getElementById("fetchProgress");
    }

    static setValue(value) {
        ProgressBar.getUiElement().value = value;
        ProgressBar.updateText();
    }

    static updateValue(increment) {
        ProgressBar.getUiElement().value += increment;
        ProgressBar.updateText();
    }

    static setMax(max) {
        ProgressBar.getUiElement().max = max;
        ProgressBar.updateText();
    }

    /**
     * Switch the bar into "packing" mode, where it shows a 0% to 100%
     * value instead of "value/max", used while the EPUB file itself
     * is being assembled (after all chapters have been downloaded).
     */
    static startPackingPhase() {
        ProgressBar.packingPhase = true;
        let element = ProgressBar.getUiElement();
        element.max = 100;
        element.value = 0;
        ProgressBar.updateText();
    }

    /**
     * Update progress while in "packing" mode.
     * @param {number} value number of items packed so far
     * @param {number} max total number of items to pack
     */
    static setPackingProgress(value, max) {
        let element = ProgressBar.getUiElement();
        element.max = 100;
        element.value = (max > 0) ? Math.round((value * 100) / max) : 100;
        ProgressBar.updateText();
    }

    /** Return the bar to normal "value/max" chapter download mode. */
    static endPackingPhase() {
        ProgressBar.packingPhase = false;
    }

    static updateText() {
        let element = ProgressBar.getUiElement();
        let text = "";
        if (ProgressBar.packingPhase) {
            text = `${element.value}%`;
            ProgressBar.updateTabTitle(element.value, 100);
        } else if (1 < element.max) {
            text = `${element.value}/${element.max}`;
            ProgressBar.updateTabTitle(element.value, element.max);
        }
        document.getElementById("progressString").textContent = text;
    }

    static updateTabTitle(value, max) {
        value = (value*100/max).toFixed(1);
        if (value == "100.0") {
            value = "100";
        }
        document.title = value + "% WebToEpub";
    }
}

ProgressBar.packingPhase = false;
