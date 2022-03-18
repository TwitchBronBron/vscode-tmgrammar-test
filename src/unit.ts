#!/usr/bin/env node

import * as fs from 'fs';
import chalk from 'chalk';
import program from 'commander';
import glob from 'glob';
import {
  createRegistry,
  runGrammarTestCase,
  parseGrammarTestCase,
  GrammarTestCase,
  handleGrammarTestError,
  displayTestResultCompact,
  displayTestResultFull
} from './unit/index';
import { terminalWidth } from './common';

let packageJson = require('../../package.json');

function collectGrammarOpts(value: String, previous: String[]): String[] {
  return previous.concat([value]);
}

// * don't forget the '' vscode-tmgrammar-test -s source.dhall -g testcase/dhall.tmLanguage.json -t '**/*.dhall'
program
  .version(packageJson.version)
  .description('Run Textmate grammar test cases using vscode-textmate')
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
  .option(
    '-v, --validate',
    'Validate the grammar file for well-formedness and pattern validity instead of running testcases.'
  )
  .option(
    '-c, --compact',
    'Display output in the compact format, which is easier to use with VSCode problem matchers'
  )
  .parse(process.argv);

if (
  program.scope === undefined ||
  program.grammar === undefined ||
  program.grammar.length === 0 ||
  (
    program.testcases === undefined &&
    program.validate === undefined
  )
) {
  program.help();
}


const TestFailed = -1;
const TestSuccessful = 0;

const registry = createRegistry(program.grammar);

if (program.validate) {
  if (!!registry && typeof registry === 'object') {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

const displayTestResult = program.compact
  ? displayTestResultCompact
  : displayTestResultFull;

glob(program.testcases, (err, files) => {
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
  if (files.length === 0) {
    console.log(chalk.red('ERROR') + ' no test cases found');
    process.exit(-1);
  }
  const testResults: Promise<number[]> = Promise.all(
    files.map(
      (filename): Promise<number> => {
        let tc: GrammarTestCase | undefined = undefined;
        try {
          tc = parseGrammarTestCase(fs.readFileSync(filename).toString());
        } catch (error) {
          console.log(
            chalk.red('ERROR') +
            " can't parse testcase: " +
            chalk.whiteBright(filename) +
            ''
          );
          console.log(error);
          return new Promise((resolve, reject) => {
            resolve(TestFailed);
          });
        }
        let testCase = tc as GrammarTestCase;
        return runGrammarTestCase(registry, testCase)
          .then((failures) => {
            return displayTestResult(filename, testCase, failures, terminalWidth);
          })
          .catch((error: any) => {
            return handleGrammarTestError(filename, testCase, error);
          });
      }
    )
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
