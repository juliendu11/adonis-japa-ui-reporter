import {NamedReporterContract} from "@japa/runner/types";
import UIReporter from "./ui_reporter.js";
import type {UIReporterOptions} from "./types.js";

export const ui: (options?: UIReporterOptions) => NamedReporterContract = (options) => {
    return {
        name: 'ui',
        handler: (...args) => new UIReporter(options).boot(...args),
    }
}
