export type JSONPatch = Record<string, any> & {
	length?: never;
};
export type Paths = [
	string,
	any
][];
export type WatcherArgsValue = string | Element | DocumentFragment | undefined;
export type WatcherArgs = Record<string, WatcherArgsValue>;
export type ErrorFn = (name: string, ctx?: Record<string, any>) => Error;
export type ActionContext = {
	el: HTMLOrSVG;
	evt?: Event;
	error: ErrorFn;
	cleanups: Map<string, () => void>;
};
export type RequirementType = "allowed" | "must" | "denied" | "exclusive";
export type Requirement = RequirementType | {
	key: Exclude<RequirementType, "exclusive">;
	value?: Exclude<RequirementType, "exclusive">;
} | {
	key?: Exclude<RequirementType, "exclusive">;
	value: Exclude<RequirementType, "exclusive">;
};
export type Rx<B extends boolean> = (...args: any[]) => B extends true ? unknown : void;
export type ReqField<R, K extends "key" | "value", Return> = R extends "must" | {
	[P in K]: "must";
} ? Return : R extends "denied" | {
	[P in K]: "denied";
} ? undefined : R extends "allowed" | {
	[P in K]: "allowed";
} | (K extends keyof R ? never : R) ? Return | undefined : never;
export type ReqFields<R extends Requirement, B extends boolean> = R extends "exclusive" ? {
	key: string;
	value: undefined;
	rx: undefined;
} | {
	key: undefined;
	value: string;
	rx: Rx<B>;
} : {
	key: ReqField<R, "key", string>;
	value: ReqField<R, "value", string>;
	rx: ReqField<R, "value", Rx<B>>;
};
export type AttributeContext<R extends Requirement = Requirement, RxReturn extends boolean = boolean> = {
	el: HTMLOrSVG;
	mods: Modifiers;
	rawKey: string;
	evt?: Event;
	error: ErrorFn;
	loadedPluginNames: {
		actions: Readonly<Set<string>>;
		attributes: Readonly<Set<string>>;
	};
} & ReqFields<R, RxReturn>;
export type AttributePlugin<R extends Requirement = Requirement, RxReturn extends boolean = boolean> = {
	name: string;
	apply: (ctx: AttributeContext<R, RxReturn>) => void | (() => void);
	requirement?: R;
	returnsValue?: RxReturn;
	argNames?: string[];
};
export type WatcherContext = {
	error: ErrorFn;
};
export type WatcherPlugin = {
	name: string;
	apply: (ctx: WatcherContext, args: WatcherArgs) => void;
};
export type ActionPlugin<T = any> = {
	name: string;
	apply: (ctx: ActionContext, ...args: any[]) => T;
};
export type MergePatchArgs = {
	ifMissing?: boolean;
};
export type HTMLOrSVG = HTMLElement | SVGElement | MathMLElement;
export type Modifiers = Map<string, Set<string>>;
export type SignalFilterOptions = {
	include?: RegExp | string;
	exclude?: RegExp | string;
};
export type Signal<T> = {
	(): T;
	(value: T): boolean;
};
export type Computed<T> = () => T;
export type Effect = () => void;
export declare const actions: Record<string, (ctx: ActionContext, ...args: any[]) => any>;
export declare const attribute: <R extends Requirement, B extends boolean>(plugin: AttributePlugin<R, B>) => void;
export declare const action: <T>(plugin: ActionPlugin<T>) => void;
export declare const watcher: (plugin: WatcherPlugin) => void;
export interface ReactiveNode {
	deps_?: Link;
	depsTail_?: Link;
	subs_?: Link;
	subsTail_?: Link;
	flags_: ReactiveFlags;
}
export interface Link {
	version_: number;
	dep_: ReactiveNode;
	sub_: ReactiveNode;
	prevSub_?: Link;
	nextSub_?: Link;
	prevDep_?: Link;
	nextDep_?: Link;
}
declare enum ReactiveFlags {
	None = 0,
	Mutable = 1,
	Watching = 2,
	RecursedCheck = 4,
	Recursed = 8,
	Dirty = 16,
	Pending = 32
}
export declare const beginBatch: () => void;
export declare const endBatch: () => void;
export declare const startPeeking: (sub?: ReactiveNode) => void;
export declare const stopPeeking: () => void;
export declare const signal: <T>(initialValue?: T) => Signal<T>;
export declare const computed: <T>(getter: (previousValue?: T) => T) => Computed<T>;
export declare const effect: (fn: () => void) => Effect;
export declare const getPath: <T = any>(path: string) => T | undefined;
export declare const mergePatch: (patch: JSONPatch, { ifMissing }?: MergePatchArgs) => void;
export declare const mergePaths: (paths: Paths, options?: MergePatchArgs) => void;
/**
 * Filters the root store based on an include and exclude RegExp
 *
 * @returns The filtered object
 */
export declare const filtered: ({ include, exclude }?: SignalFilterOptions, obj?: JSONPatch) => Record<string, any>;
export declare const root: Record<string, any>;

export {};
