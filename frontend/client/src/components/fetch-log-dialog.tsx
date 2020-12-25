import { h, render } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { IFetchLogItem, IFetchLogTime } from '../data';
import Dialog from './dialog';
import get from '../locale';
import './fetch-log-dialog.less';

type HeadlessProps = {
    log: IFetchLogItem[],
    onClose: () => void,
};

enum FetchTimeMode {
    SCRIPT,
    REAL,
}

type Options = {
    timeMode: FetchTimeMode,
    toggleTimeMode: () => void,
};

class Headless extends PureComponent<HeadlessProps> {
    state = {
        open: false,
    };

    componentDidMount() {
        this.setState({ open: true });
    }

    onClose = () => {
        this.setState({ open: false });
        setTimeout(this.props.onClose, 1000);
    };

    render() {
        return (
            <FetchLogDialog
                log={this.props.log}
                open={this.state.open}
                onClose={this.onClose} />
        );
    }
}

export default class FetchLogDialog extends PureComponent<FetchLogDialog.Props> {
    state = {
        options: {
            timeMode: FetchTimeMode.SCRIPT,
            toggleTimeMode: () => this.toggleTimeMode(),
        },
    };

    dialog = createRef();

    componentDidMount() {
        // put above error popout
        this.dialog.current.portalContainer.style.zIndex = 1001;
    }

    toggleTimeMode () {
        let timeMode = this.state.options.timeMode;
        if (timeMode == FetchTimeMode.SCRIPT) timeMode = FetchTimeMode.REAL;
        else if (timeMode == FetchTimeMode.REAL) timeMode = FetchTimeMode.SCRIPT;

        this.setState({
            options: {
                ...this.state.options,
                timeMode,
            },
        });
    }

    render() {
        return (
            <Dialog
                ref={this.dialog}
                class="fetch-log-dialog"
                title={get('sources.fetch.log.title')}
                open={this.props.open}
                closeButton
                onClose={this.props.onClose}>
                <FetchLog log={this.props.log} options={this.state.options} />
            </Dialog>
        )
    }

    static run(log: IFetchLogItem[]) {
        const mount = document.createElement('div');
        mount.className = 'fetch-log-dialog-mount';
        const onClose = () => mount.remove();
        document.body.appendChild(mount);
        render(<Headless log={log} onClose={onClose} />, mount);
    }
}
namespace FetchLogDialog {
    export interface Props {
        log: IFetchLogItem[],
        open?: boolean,
        onClose?: () => void,
    }
}

class FetchLog extends PureComponent<FetchLog.Props> {
    render() {
        const options = this.props.options;

        return (
            <ul class="fetch-log">
                {this.props.log.map(item => <FetchLogItem item={item} options={options} />)}
            </ul>
        );
    }
}
namespace FetchLog {
    export interface Props {
        log: IFetchLogItem[],
        options: Options,
    }
}

function FetchLogItem({ item, options }: { item: IFetchLogItem, options: Options }) {
    return (
        <li class="fetch-log-item" data-type={item.type}>
            <FetchLogTime time={item.time} options={options} />
            <span class="log-type">{item.type.toUpperCase()}</span>
            <span class="log-fragments">
                {item.message.map(frag => <FetchLogFrag frag={frag} />)}
            </span>
        </li>
    );
}

function FetchLogTime({ time, options }: { time?: IFetchLogTime, options: Options }) {
    if (!time) return null;
    let value = time.script;
    if (options.timeMode === FetchTimeMode.REAL) value = time.real;

    return (
        <span
            class={'log-time' + (options.timeMode === FetchTimeMode.REAL ? ' is-real' : '')}
            onClick={options.toggleTimeMode}>
            {value.toFixed(2)}s
        </span>
    );
}

function MultiLineString({ string }: { string: string }) {
    let items = [];
    for (const line of string.split('\n')) {
        if (items.length) items.push(<br />);
        items.push(line);
    }

    return (
        <span>
            {items}
        </span>
    );
}

function FetchLogFrag({ frag }: { frag: { t: string, c: any } }) {
    const { t, c } = frag;
    if (t === 'log') {
        return <span class="frag-log"><MultiLineString string={c} /></span>;
    } else if (t === 'class_name') {
        return <span class="frag-class-name">{c} </span>;
    } else if (t === 'object_start') {
        return <span class="frag-object-start">{'{ '}</span>;
    } else if (t === 'error_trace') {
        return <span class="frag-error-trace"><MultiLineString string={c} /></span>;
    } else if (t === 'object_end') {
        return <span class="frag-object-end">{' }'}</span>;
    } else if (t === 'array_start') {
        return <span class="frag-array-start">[</span>;
    } else if (t === 'array_end') {
        return <span class="frag-array-end">]</span>;
    } else if (t === 'object_maps_to') {
        return <span class="frag-object-maps-to">: </span>;
    } else if (t === 'list_sep') {
        return <span class="frag-list-step">, </span>;
    } else if (t === 'truncated') {
        return <span class="frag-truncated">...</span>;
    } else if (t === 'undefined') {
        return <span class="frag-undefined">undefined</span>
    } else if (t === 'null') {
        return <span class="frag-null">null</span>
    } else if (t === 'bool') {
        return <span class="frag-bool">{c ? 'true' : 'false'}</span>
    } else if (t === 'number') {
        return <span class="frag-number">{c}</span>
    } else if (t === 'string') {
        return <span class="frag-string">{JSON.stringify(c)}</span>
    } else if (t === 'symbol') {
        return <span class="frag-symbol">Symbol({c})</span>
    } else if (t === 'key_string') {
        return <span class="frag-key-string">{c}</span>
    } else if (t === 'key_symbol') {
        return <span class="frag-key-symbol">[Symbol({c})]</span>
    } else if (t === 'circular') {
        return <span class="frag-circular">[circular]</span>
    } else if (t === 'function') {
        return <span class="frag-function">[function {c}]</span>
    } else if (t === 'unknown') {
        return <span class="frag-unknown">?</span>
    } else if (t === 'arg_sep') {
        return <span class="frag-arg-sep"> </span>
    }
    return null;
}
