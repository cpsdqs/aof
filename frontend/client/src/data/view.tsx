import { h, VNode } from 'preact';
import { PureComponent } from 'preact/compat';
import { EventEmitter } from 'uikit';
import { canLoad, load } from './load';
import { cache, views } from './cache';
import { Key, FnLoad, FnR, Load, FnA } from './paths';

// TODO: refresh views when socket reconnects
export class View<T> extends EventEmitter {
    private readonly key: Key<T>;

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

    get loaded() {
        return cache.has(this.key);
    }

    get() {
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
        if (!this.loaded) this.load();
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
    shouldLoad?: boolean,
    key?: string,
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
