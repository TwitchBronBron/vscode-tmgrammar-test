import * as tty from 'tty';
export const TestFailed = -1;
export const TestSuccessful = 0;
export const Padding = '  ';
export const isatty = tty.isatty(1) && tty.isatty(2);
export const terminalWidth = isatty ? (process.stdout as tty.WriteStream).getWindowSize()[0] : 75;

export const symbols = {
    ok: '✓',
    err: '✖',
    dot: '․',
    comma: ',',
    bang: '!'
};

if (process.platform === 'win32') {
    symbols.ok = '\u221A';
    symbols.err = '\u00D7';
    symbols.dot = '.';
}

export function toMap<T>(f: (x: T) => string, xs: T[]): Record<string | number, T> {
    return xs.reduce((m: { [key: string]: T }, x: T) => {
        m[f(x)] = x;
        return m;
    }, {});
}

export function flatten<T>(arr: T[][]): T[] {
    return arr.reduce((acc, val) => acc.concat(val), []);
}
