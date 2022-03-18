import * as tm from 'vscode-textmate';
import { AnnotatedLine, TChange, TChanges } from './model';
import chalk from 'chalk';
import { flatten, Padding, symbols, TestFailed, TestSuccessful, toMap } from '../common';
import { EOL } from 'os';
import * as diff from 'diff';

export async function getVSCodeTokens(
  registry: tm.Registry,
  scope: string,
  source: string
): Promise<AnnotatedLine[]> {
  return registry.loadGrammar(scope).then((grammar: tm.IGrammar | null) => {
    if (!grammar) {
      throw new Error(`Could not load scope ${scope}`);
    }

    let ruleStack: tm.StackElement = <any>null;

    return source.split(/\r\n|\n/).map((line: string, n: number) => {
      var { tokens, ruleStack: ruleStack1 } = grammar.tokenizeLine(
        line,
        ruleStack
      );
      ruleStack = ruleStack1;

      return <AnnotatedLine>{
        src: line,
        tokens: tokens
      };
    });
  });
}

export function renderSnapshotTestResult(
  filename: string,
  expected: AnnotatedLine[],
  actual: AnnotatedLine[],
  options: {
    printNotModified?: boolean,
    expandDiff?: boolean
  }
): number {
  if (expected.length !== actual.length) {
    console.log(
      chalk.red('ERROR running testcase ') +
      chalk.whiteBright(filename) +
      chalk.red(
        ` snapshot and actual file contain different number of lines.${EOL}`
      )
    );
    return TestFailed;
  }

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const act = actual[i];
    if (exp.src !== act.src) {
      console.log(
        chalk.red('ERROR running testcase ') +
        chalk.whiteBright(filename) +
        chalk.red(
          ` source different snapshot at line ${i + 1}.${EOL} expected: ${exp.src
          }${EOL} actual: ${act.src}${EOL}`
        )
      );
      return TestFailed;
    }
  }

  // renderSnap won't produce assertions for empty lines, so we'll remove them here
  // for both actual end expected
  let actual1 = actual.filter((a) => a.src.trim().length > 0);
  let expected1 = expected.filter((a) => a.src.trim().length > 0);

  const wrongLines = flatten(
    expected1.map((exp, i) => {
      const act = actual1[i];

      const expTokenMap = toMap(
        (t) => `${t.startIndex}:${t.startIndex}`,
        exp.tokens
      );
      const actTokenMap = toMap(
        (t) => `${t.startIndex}:${t.startIndex}`,
        act.tokens
      );

      const removed = exp.tokens
        .filter(
          (t) => actTokenMap[`${t.startIndex}:${t.startIndex}`] === undefined
        )
        .map((t) => {
          return <TChanges>{
            changes: [
              <TChange>{
                text: t.scopes.join(' '),
                changeType: Removed
              }
            ],
            from: t.startIndex,
            to: t.endIndex
          };
        });
      const added = act.tokens
        .filter(
          (t) => expTokenMap[`${t.startIndex}:${t.startIndex}`] === undefined
        )
        .map((t) => {
          return <TChanges>{
            changes: [
              <TChange>{
                text: t.scopes.join(' '),
                changeType: Added
              }
            ],
            from: t.startIndex,
            to: t.endIndex
          };
        });

      const modified = flatten(
        act.tokens.map((a) => {
          const e = expTokenMap[`${a.startIndex}:${a.startIndex}`];
          if (e !== undefined) {
            const changes = diff.diffArrays(e.scopes, a.scopes);
            if (
              changes.length === 1 &&
              !changes[0].added &&
              !changes[0].removed
            ) {
              return [];
            }

            const tchanges = changes.map((change) => {
              let changeType = change.added
                ? Added
                : change.removed
                  ? Removed
                  : NotModified;
              return <TChange>{
                text: change.value.join(' '),
                changeType: changeType
              };
            });
            return [
              <TChanges>{
                changes: tchanges,
                from: a.startIndex,
                to: a.endIndex
              }
            ];
          } else {
            return [];
          }
        })
      );

      const allChanges = modified
        .concat(added)
        .concat(removed)
        .sort((x, y) => (x.from - y.from) * 10000 + (x.to - y.to));
      if (allChanges.length > 0) {
        return [[allChanges, exp.src, i] as [TChanges[], string, number]];
      } else {
        return [];
      }
    })
  );

  if (wrongLines.length > 0) {
    console.log(chalk.red('ERROR in test case ') + chalk.whiteBright(filename));
    console.log(Padding + Padding + chalk.red('-- existing snapshot'));
    console.log(Padding + Padding + chalk.green('++ new changes'));
    console.log();

    if (options.expandDiff) {
      printDiffOnTwoLines(wrongLines, options.printNotModified);
    } else {
      printDiffInline(wrongLines, options.printNotModified);
    }

    console.log();
    return TestFailed;
  } else {
    console.log(
      chalk.green(symbols.ok) +
      ' ' +
      chalk.whiteBright(filename) +
      ' run successfully.'
    );
    return TestSuccessful;
  }
}

function printDiffInline(wrongLines: [TChanges[], string, number][], printNotModified = false) {
  wrongLines.forEach(([changes, src, i]) => {
    const lineNumberOffset = printSourceLine(src, i);
    changes.forEach((tchanges) => {
      const change = tchanges.changes
        .filter((c) => printNotModified || c.changeType !== NotModified)
        .map((c) => {
          let color =
            c.changeType === Added
              ? chalk.green
              : c.changeType === Removed
                ? chalk.red
                : chalk.gray;
          return color(c.text);
        })
        .join(' ');
      printAccents(lineNumberOffset, tchanges.from, tchanges.to, change);
    });
    console.log();
  });
}

function printDiffOnTwoLines(wrongLines: [TChanges[], string, number][], printNotModified = false) {
  wrongLines.forEach(([changes, src, i]) => {
    const lineNumberOffset = printSourceLine(src, i);
    changes.forEach((tchanges) => {
      const removed = tchanges.changes
        .filter(
          (c) =>
            c.changeType === Removed ||
            (c.changeType === NotModified && printNotModified)
        )
        .map((c) => {
          return chalk.red(c.text);
        })
        .join(' ');
      const added = tchanges.changes
        .filter(
          (c) =>
            c.changeType === Added ||
            (c.changeType === NotModified && printNotModified)
        )
        .map((c) => {
          return chalk.green(c.text);
        })
        .join(' ');
      printAccents1(
        lineNumberOffset,
        tchanges.from,
        tchanges.to,
        chalk.red('-- ') + removed,
        Removed
      );
      printAccents1(
        lineNumberOffset,
        tchanges.from,
        tchanges.to,
        chalk.green('++ ') + added,
        Added
      );
    });
    console.log();
  });
}

const NotModified = 0;
const Removed = 1;
const Added = 2;

function printSourceLine(line: String, n: number): number {
  const pos = n + 1 + ': ';

  console.log(Padding + chalk.gray(pos) + line);
  return pos.length;
}

function printAccents(offset: number, from: number, to: number, diff: string) {
  const accents = ' '.repeat(from) + '^'.repeat(to - from);
  console.log(Padding + ' '.repeat(offset) + accents + ' ' + diff);
}

function printAccents1(
  offset: number,
  from: number,
  to: number,
  diff: string,
  change: number
) {
  let color =
    change === Added
      ? chalk.green
      : change === Removed
        ? chalk.red
        : chalk.gray;
  let prefix = change === Added ? '++' : change === Removed ? '--' : '  ';
  const accents = color(' '.repeat(from) + '^'.repeat(to - from));
  console.log(color(prefix) + ' '.repeat(offset) + accents + ' ' + diff);
}
