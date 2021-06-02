import { h, VNode } from 'preact';
import { PureComponent } from 'preact/compat';
import { EventEmitter } from 'uikit';
import { canLoad, load } from './load';
import { cache, partials, views } from './cache';
import { Key, FnLoad, FnR } from './paths';

// TODO: refresh views when socket reconnects
export class View<T> extends EventEmitter {
    private readonly key: Key<T>;
    keepCached = false;
    cached: T | null = null;
    usePartials = false;

    constructor(key: Key<T>) {
        super();
        this.key = key;

        if (!views.has(this.key)) views.set(this.key, new Set());
        views.get(this.key).add(this);

        if (this.loaded) {
            this.notify();
        } else {
            this.load();
        }
    }

    load() {
        if (canLoad(this.key)) {
            load(this.key).catch(this.notifyError);
        }
    }

    get isPartial() {
        return !this.loaded && this.partialLoaded;
    }

    get partialLoaded() {
        return this.loaded || (this.usePartials && partials.has(this.key));
    }

    get loaded() {
        if (this.keepCached && this.cached) return true;
        return cache.has(this.key);
    }

    get() {
        if (this.keepCached) {
            if (!cache.has(this.key)) return this.cached;
            this.cached = cache.get(this.key);
        }

        if (this.usePartials) {
            if (this.loaded) return cache.get(this.key);
            return partials.get(this.key);
        }
        return cache.get(this.key);
    }

    lastError = null;
    getError() {
        return this.lastError;
    }

    get hasError() {
        return this.lastError !== null;
    }

    notify() {
        this.lastError = null;
        if (!this.partialLoaded) this.load();
        this.emit('update', this.get());
    }

    ping(value: T) {
        this.emit('ping', value);
    }

    notifyError = (error: any) => {
        console.error('Error in view', this, error);
        this.lastError = error;
        this.emit('error', error);
    };

    drop() {
        views.get(this.key).delete(this);
    }
}

type ConnectFn<T> = (v: View<T>) => VNode | null;

type IOptions = {
    // if false, will not load data
    shouldLoad?: boolean,
    // if true, will temporarily keep the cached data if cache is cleared
    keepCached?: boolean,
    // jsx key
    key?: string,
    // if true, will try to parse partial responses
    usePartials?: boolean,
};

// This function exists because typescript type inference sucks
export function connectf<T extends FnLoad<any, any, any>>(view: T, render: ConnectFn<FnR<T>>, opts?: IOptions): VNode {
    return connect(view, render, opts);
}

export function connect<T>(view: Key<T>, render: ConnectFn<T>, opts?: IOptions): VNode {
    return <Connection key={opts?.key} view={view} render={render} opts={opts} />;
}

/// A lazy version of load.
export async function lazyLoad<T>(node: Key<T>): Promise<T | null> {
    if (cache.has(node)) {
        return cache.get(node);
    } else if (canLoad(node)) {
        return await load(node);
    }
    return null;
}

export class Connection<T> extends PureComponent<Connection.Props<T>> {
    view: View<T> | null = null;

    initView() {
        this.view = new View(this.props.view);
        this.view.on('ping', this.onPing);
        this.view.on('update', this.viewDidUpdate);
        this.view.on('error', this.viewDidUpdate);
        this.view.keepCached = this.props.opts?.keepCached || false;
        this.view.usePartials = this.props.opts?.usePartials || false;
        this.forceUpdate();
    }
    viewDidUpdate = () => {
        this.forceUpdate();
    };
    onPing = (value: T) => {
        if (this.props.onPing) this.props.onPing(value);
    };
    dropView() {
        if (this.view) {
            this.view.drop();
            this.view = null;
        }
    }

    componentDidMount() {
        if (typeof this.props.opts?.shouldLoad !== 'boolean') this.initView();
    }
    componentDidUpdate(prevProps: Connection.Props<T>) {
        if (prevProps.view !== this.props.view) {
            this.dropView();
            this.initView();
        }
        if (prevProps.opts !== this.props.opts) {
            if (!this.view && (!this.props.opts || this.props.opts?.shouldLoad)) this.initView();
        }
    }
    componentWillUnmount() {
        this.dropView();
    }

    render() {
        if (!this.view && typeof this.props.opts?.shouldLoad !== 'boolean') return null;
        return this.props.render(this.view!);
    }
}

namespace Connection {
    export interface Props<T> {
        view: Key<T>,
        render: (view: View<T>) => VNode | null,
        onPing?: (value: T) => void,
        opts?: IOptions,
    }
}
