import type ThePlugin from "../main";
import { FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch } from "obsidian";

/**
 * Simple interface for what should be displayed and stored for suggester
 */
export interface SuggesterItem {
    // displayed to user
    display: string;
    // supplmental info for the callback
    info: (() => void) | string;
}

/**
 * Generic suggester for quick reuse
 */
export class GenericFuzzySuggester extends FuzzySuggestModal<SuggesterItem> {
    data: SuggesterItem[] = [];
    callbackFunction!: (item: SuggesterItem, evt: MouseEvent | KeyboardEvent) => void;

    constructor(plugin: ThePlugin) {
        super(plugin.app);
        this.scope.register(["Shift"], "Enter", (evt) => {
            this.enterTrigger(evt);
        });
        this.scope.register(["Ctrl"], "Enter", (evt) => {
            this.enterTrigger(evt);
        });
    }

    public setSuggesterData(suggesterData: SuggesterItem[]): void {
        this.data = suggesterData;
    }

    public display(callBack: (item: SuggesterItem, evt: MouseEvent | KeyboardEvent) => void) {
        this.callbackFunction = callBack;
        this.open();
    }

    public getItems(): SuggesterItem[] {
        return this.data;
    }

    public getItemText(item: SuggesterItem): string {
        return item.display;
    }

    public onChooseItem(): void {
        return;
    }

    public renderSuggestion(item: FuzzyMatch<SuggesterItem>, el: HTMLElement): void {
        el.createEl("div", { text: item.item.display });
    }

    public enterTrigger(evt: KeyboardEvent): void {
        const selectedText = document.querySelector(
            ".suggestion-item.is-selected div"
        )?.textContent;
        const item = this.data.find((i) => i.display === selectedText);
        if (item) {
            this.invokeCallback(item, evt);
            this.close();
        }
    }

    public onChooseSuggestion(
        item: FuzzyMatch<SuggesterItem>,
        evt: MouseEvent | KeyboardEvent
    ): void {
        this.invokeCallback(item.item, evt);
    }

    public invokeCallback(item: SuggesterItem, evt: MouseEvent | KeyboardEvent): void {
        if (typeof this.callbackFunction === "function") {
            (
                this.callbackFunction as (
                    item: SuggesterItem,
                    evt: MouseEvent | KeyboardEvent
                ) => void
            )(item, evt);
        }
    }
}
