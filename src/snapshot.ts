#!/usr/bin/env node

import * as fs from 'fs';
import * as tty from 'tty';
import chalk from 'chalk';
import program from 'commander';
import glob from 'glob';
import { createRegistry } from './unit/index';
import { EOL } from 'os';
import { getVSCodeTokens, renderSnapshotTestResult } from './snapshot/index';
import { renderSnap, parseSnap } from './snapshot/parsing';
import { AnnotatedLine, IToken } from './snapshot/model';
import { TestFailed, TestSuccessful } from './common';

let packageJson = require('../../package.json');

function collectGrammarOpts(value: String, previous: String[]): String[] {
  return previous.concat([value]);
}

program
  .version(packageJson.version)
  .description('Run VSCode textmate grammar snapshot tests')
  .option('-s, --scope <scope>', 'Language scope, e.g. source.dhall')
  .option(
    '-g, --grammar <grammar>',
    'Path to a grammar file, either .json or .xml. This option can be specified multiple times if multiple grammar needed.',
    collectGrammarOpts,
    []
  )
  .option(
    '-t, --testcases <glob>',
    'A glob pattern which specifies testcases to run, e.g. "./tests/**/test*.dhall". Quotes are important!'
  )
  .option('-u, --updateSnapshot', 'overwrite all snap files with new changes')
  .option(
    '--printNotModified',
    'include not modified scopes in the output',
    false
  )
  .option(
    '--expandDiff',
    'produce each diff on two lines prefixed with "++" and "--"',
    false
  )
  .parse(process.argv);

if (
  program.scope === undefined ||
  program.grammar === undefined ||
  program.grammar.length === 0 ||
  program.testcases === undefined
) {
  program.help();
}

const registry = createRegistry(program.grammar);

glob(program.testcases, (err, files0) => {
  if (err !== null) {
    console.log(
      chalk.red('ERROR') +
      " glob pattern is incorrect: '" +
      chalk.gray(program.testcases) +
      "'"
    );
    console.log(err);
    process.exit(-1);
  }
  const files = files0.filter((x) => !x.endsWith('.snap'));
  if (files.length === 0) {
    console.log(chalk.red('ERROR') + ' no test cases found');
    process.exit(-1);
  }
  const options = { printNotModified: program.printNotModified, expandDiff: program.expandDiff };
  const testResults: Promise<number[]> = Promise.all(
    files.map((filename) => {
      const src = fs.readFileSync(filename).toString();
      return getVSCodeTokens(registry, program.scope, src)
        .then((tokens) => {
          if (fs.existsSync(filename + '.snap')) {
            if (program.updateSnapshot) {
              console.log(
                chalk.yellowBright('Updating snapshot for') +
                chalk.whiteBright(filename + '.snap')
              );
              fs.writeFileSync(filename + '.snap', renderSnap(tokens), 'utf8');
              return TestSuccessful;
            } else {
              const expectedTokens = parseSnap(
                fs.readFileSync(filename + '.snap').toString()
              );
              return renderSnapshotTestResult(filename, expectedTokens, tokens, options);
            }
          } else {
            console.log(
              chalk.yellowBright('Generating snapshot ') +
              chalk.whiteBright(filename + '.snap')
            );
            fs.writeFileSync(filename + '.snap', renderSnap(tokens));
            return TestSuccessful;
          }
        })
        .catch((error) => {
          console.log(
            chalk.red('ERROR') +
            " can't run testcase: " +
            chalk.whiteBright(filename)
          );
          console.log(error);
          return TestFailed;
        });
    })
  );

  testResults.then((xs) => {
    const result = xs.reduce((a, b) => a + b, 0);
    if (result === TestSuccessful) {
      process.exit(0);
    } else {
      process.exit(-1);
    }
  });
});
