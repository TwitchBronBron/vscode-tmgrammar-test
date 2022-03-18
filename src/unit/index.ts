import * as fs from 'fs';
import * as tm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';
import { GrammarTestCase, TestFailure } from './model';
import { parseGrammarTestCase } from './parsing';
import { EOL } from 'os';
import chalk from 'chalk';
import { Padding, TestFailed, TestSuccessful, toMap } from '../common';

const symbols = {
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

export { parseGrammarTestCase, GrammarTestCase, TestFailure, missingScopes_ };

export async function runGrammarTestCase(
  registry: tm.Registry,
  testCase: GrammarTestCase
): Promise<TestFailure[]> {
  return registry
    .loadGrammar(testCase.metadata.scope)
    .then((grammar: tm.IGrammar | null) => {
      if (!grammar) {
        throw new Error(`Could not load scope ${testCase.metadata.scope}`);
      }

      const assertions = toMap((x) => x.sourceLineNumber.toString(), testCase.assertions);

      let ruleStack: tm.StackElement = <any>null;

      let failures: TestFailure[] = [];

      testCase.source.forEach((line: string, n: number) => {
        var { tokens, ruleStack: ruleStack1 } = grammar.tokenizeLine(
          line,
          ruleStack
        );
        ruleStack = ruleStack1;

        if (assertions[n] !== undefined) {
          let { testCaseLineNumber, scopeAssertions } = assertions[n];

          scopeAssertions.forEach(
            ({ from, to, scopes: requiredScopes, exclude: excludedScopes }) => {
              const xs = tokens.filter(
                (t) => from < t.endIndex && to > t.startIndex
              );
              if (xs.length === 0 && requiredScopes.length > 0) {
                failures.push(<TestFailure>{
                  missing: requiredScopes,
                  unexpected: [],
                  actual: [],
                  line: testCaseLineNumber,
                  srcLine: n,
                  start: from,
                  end: to
                });
              } else {
                xs.forEach((token) => {
                  const unexpected = excludedScopes.filter((s) => {
                    return token.scopes.includes(s);
                  });
                  const missing = missingScopes_(requiredScopes, token.scopes);

                  if (missing.length || unexpected.length) {
                    failures.push(<TestFailure>{
                      missing: missing,
                      actual: token.scopes,
                      unexpected: unexpected,
                      line: testCaseLineNumber,
                      srcLine: n,
                      start: token.startIndex,
                      end: token.endIndex
                    });
                  }
                });
              }
            }
          );
        }
      });
      return failures;
    });
}

export function createRegistryFromGrammars(
  grammars: Array<{ path: string; content: string }>
): tm.Registry {
  let grammarIndex: { [key: string]: tm.IRawGrammar } = {};

  for (const grammar of grammars) {
    const { path, content } = grammar;
    let rawGrammar = tm.parseRawGrammar(content, path);
    grammarIndex[rawGrammar.scopeName] = rawGrammar;
  }

  const wasmPath = require.resolve('vscode-oniguruma').replace(/main\.js$/, 'onig.wasm')
  const wasmBin = fs.readFileSync(wasmPath).buffer;
  const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
      createOnigScanner(patterns: any) { return new oniguruma.OnigScanner(patterns); },
      createOnigString(s: any) { return new oniguruma.OnigString(s); }
    };
  });

  return new tm.Registry(<tm.RegistryOptions>{
    onigLib: vscodeOnigurumaLib,
    loadGrammar: (scopeName) => {
      if (grammarIndex[scopeName] !== undefined) {
        return new Promise((fulfill, _) => {
          fulfill(grammarIndex[scopeName]);
        });
      }
      console.warn(`grammar not found for "${scopeName}"`);
      return null;
    }
  });
}

export function createRegistry(grammarPaths: string[]): tm.Registry {
  return createRegistryFromGrammars(
    grammarPaths.map((path) => {
      return {
        path,
        content: fs.readFileSync(path).toString()
      };
    })
  );
}

// ------------------------------------------------------------ helper functions --------------------------------------

function missingScopes_(rs: string[], as: string[]): string[] {
  let i = 0,
    j = 0;
  while (i < as.length && j < rs.length) {
    if (as[i] === rs[j]) {
      i++;
      j++;
    } else {
      i++;
    }
  }

  return j === rs.length ? [] : rs.slice(j);
}




function printSourceLine(testCase: GrammarTestCase, failure: TestFailure, terminalWidth: number) {
  const line = testCase.source[failure.srcLine];
  const pos = failure.line + 1 + ': ';
  const accents =
    ' '.repeat(failure.start) + '^'.repeat(failure.end - failure.start);

  const termWidth = terminalWidth - pos.length - Padding.length - 5;

  const trimLeft = failure.end > termWidth ? Math.max(0, failure.start - 8) : 0;

  const line1 = line.substr(trimLeft);
  const accents1 = accents.substr(trimLeft);

  console.log(Padding + chalk.gray(pos) + line1.substr(0, termWidth));
  console.log(Padding + ' '.repeat(pos.length) + accents1.substr(0, termWidth));
}

function printReason(testCase: GrammarTestCase, failure: TestFailure) {
  if (failure.missing && failure.missing.length > 0) {
    console.log(
      chalk.red(Padding + 'missing required scopes: ') +
      chalk.gray(failure.missing.join(' '))
    );
  }
  if (failure.unexpected && failure.unexpected.length > 0) {
    console.log(
      chalk.red(Padding + 'prohibited scopes: ') +
      chalk.gray(failure.unexpected.join(' '))
    );
  }
  if (failure.actual !== undefined) {
    console.log(
      chalk.red(Padding + 'actual: ') + chalk.gray(failure.actual.join(' '))
    );
  }
}

export function displayTestResultFull(
  filename: string,
  testCase: GrammarTestCase,
  failures: TestFailure[],
  terminalWidth: number
): number {
  if (failures.length === 0) {
    console.log(
      chalk.green(symbols.ok) +
      ' ' +
      chalk.whiteBright(filename) +
      ` run successfuly.`
    );
    return TestSuccessful;
  } else {
    console.log(chalk.red(symbols.err + ' ' + filename + ' failed'));
    failures.forEach((failure) => {
      const { l, s, e } = getCorrectedOffsets(failure);
      console.log(
        Padding +
        'at [' +
        chalk.whiteBright(`${filename}:${l}:${s}:${e}`) +
        ']:'
      );
      printSourceLine(testCase, failure, terminalWidth);
      printReason(testCase, failure);

      console.log(EOL);
    });
    console.log('');
    return TestFailed;
  }
}

function renderCompactErrorMsg(
  testCase: GrammarTestCase,
  failure: TestFailure
): string {
  let res = '';
  if (failure.missing && failure.missing.length > 0) {
    res += `Missing required scopes: [ ${failure.missing.join(' ')} ] `;
  }
  if (failure.unexpected && failure.unexpected.length > 0) {
    res += `Prohibited scopes: [ ${failure.unexpected.join(' ')} ] `;
  }
  if (failure.actual !== undefined) {
    res += `actual scopes: [${failure.actual.join(' ')}]`;
  }
  return res;
}

export function displayTestResultCompact(
  filename: string,
  testCase: GrammarTestCase,
  failures: TestFailure[]
): number {
  if (failures.length === 0) {
    console.log(
      chalk.green(symbols.ok) +
      ' ' +
      chalk.whiteBright(filename) +
      ` run successfuly.`
    );
    return TestSuccessful;
  } else {
    failures.forEach((failure) => {
      console.log(
        `ERROR ${filename}:${failure.line + 1}:${failure.start + 1}:${failure.end + 1
        } ${renderCompactErrorMsg(testCase, failure)}`
      );
    });
    return TestFailed;
  }
}

export function handleGrammarTestError(
  filename: string,
  testCase: GrammarTestCase,
  reason: any
): number {
  console.log(
    chalk.red(symbols.err) +
    ' testcase ' +
    chalk.gray(filename) +
    ' aborted due to an error'
  );
  console.log(reason);
  return TestFailed;
}


function getCorrectedOffsets(
  failure: TestFailure
): { l: number; s: number; e: number } {
  return {
    l: failure.line + 1,
    s: failure.start + 1,
    e: failure.end + 1
  };
}

