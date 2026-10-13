// Parsed, defensive projections of the parts of an event this toolset
// renders. Never a 1:1 mirror of GlitchTip's schema: the raw shapes come from
// `unknown` fields (event.parser.ts), so these are what survived parsing.

export interface ParsedFrame {
  readonly filename?: string;
  readonly absPath?: string;
  readonly function?: string;
  readonly module?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly contextLine?: string;
  readonly preContext?: readonly string[];
  readonly postContext?: readonly string[];
  readonly inApp?: boolean;
  readonly vars?: Readonly<Record<string, unknown>>;
}

export interface ParsedExceptionValue {
  readonly type?: string;
  readonly value?: string;
  readonly module?: string;
  readonly handled?: boolean;
  readonly frames: readonly ParsedFrame[];
}

/** `recognised: false` is the fixture "unknown shape" case: no crash, one note instead. */
export interface ParsedException {
  readonly recognised: boolean;
  readonly values: readonly ParsedExceptionValue[];
}

export interface ParsedBreadcrumb {
  readonly timestamp?: string;
  readonly level?: string;
  readonly category?: string;
  readonly message?: string;
}

export interface ParsedRequest {
  readonly method?: string;
  readonly url?: string;
  readonly query?: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
}

export interface ParsedTag {
  readonly key: string;
  readonly value: string;
}

export interface ParsedContextLine {
  readonly name: string;
  readonly line: string;
}

export interface ParsedEvent {
  readonly id: string;
  readonly dateReceived: string;
  readonly platform?: string;
  readonly level?: string;
  readonly release?: string;
  readonly environment?: string;
  readonly nextEventID?: string;
  readonly previousEventID?: string;
  readonly groupID: string;
  readonly exception?: ParsedException;
  readonly message?: string;
  readonly breadcrumbs: readonly ParsedBreadcrumb[];
  readonly request?: ParsedRequest;
  readonly tags: readonly ParsedTag[];
  readonly contexts: readonly ParsedContextLine[];
  readonly user?: { readonly id?: string; readonly email?: string };
  readonly errors: readonly string[];
}

/** Rendering options every detail tool exposes (spec: "the renderer options"). */
export interface RenderOptions {
  readonly includeVars: boolean;
  readonly includeContext: boolean;
  readonly includeRequestHeaders: boolean;
  readonly breadcrumbs: number;
}
