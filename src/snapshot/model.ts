import { IToken } from 'vscode-textmate';

export { IToken };

export interface AnnotatedLine {
  src: string;
  tokens: [IToken];
}

export interface TChanges {
  changes: TChange[];
  from: number;
  to: number;
}

export interface TChange {
  text: string;
  changeType: number; // 0 - not modified, 1 - removed, 2 - added
}
