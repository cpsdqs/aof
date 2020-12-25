import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import type ace from 'ace-builds';
import { Progress } from 'uikit';
import './script-editor.less';
import ErrorDisplay from './error-display';

const lazyAce = (() => {
    let l: Promise<typeof import('./script-editor-ace')>;
    return () => {
        if (!l) l = import('./script-editor-ace');
        return l;
    };
})();

export default class ScriptEditor extends PureComponent<ScriptEditor.Props> {
    state = {
        loading: true,
        error: null,
    };

    nodeRef = createRef();
    ace: typeof ace | null = null;
    unloaded = false;
    editor?: ace.Ace.Editor;

    pendingValue = this.props.value;

    componentDidMount() {
        lazyAce().then(x => {
            if (this.unloaded) return;
            this.ace = x.default;
            this.aceDidLoad();
        }).catch(error => {
            this.setState({ loading: false, error });
        });
    }

    aceDidLoad() {
        this.setState({ loading: false });
        this.editor = this.ace!.edit(this.nodeRef.current);
        this.updateTheme();
        this.updateEditable();
        this.editor.session.setMode('ace/mode/javascript');
        this.editor.session.setUseWorker(false);
        this.editor.session.getDocument().setValue(this.props.value);
        this.editor.on('change', () => {
            if (!this.editor || !this.props.onChange) return;
            const value = this.editor.session.getDocument().getAllLines().join('\n');
            this.pendingValue = value;
            this.props.onChange(value);
        });

        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', this.updateTheme);
    }

    componentWillUnmount() {
        this.unloaded = true;
        window.matchMedia('(prefers-color-scheme: light)').removeEventListener('change', this.updateTheme);
    }

    updateEditable() {
        if (!this.editor) return;
        const editable = !!this.props.onChange;
        this.editor.setReadOnly(!editable);
        this.editor.setHighlightActiveLine(editable);
        this.editor.setHighlightGutterLine(editable);
    }

    updateTheme = () => {
        if (!this.editor) return;
        if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            this.editor.setTheme('ace/theme/solarized_light');
        } else {
            this.editor.setTheme('ace/theme/nord_dark');
        }
    };

    componentDidUpdate(prevProps: ScriptEditor.Props) {
        if (!this.editor) return;
        if (prevProps.value !== this.props.value) {
            if (this.props.value === this.pendingValue) return;
            this.editor.session.getDocument().setValue(this.props.value);
        }
        if (prevProps.onChange !== this.props.onChange) {
            this.updateEditable();
        }
    }

    render({ value }: ScriptEditor.Props) {
        let className = 'script-editor ' + (this.props.class || '');

        return (
            <div class={className}>
                <div ref={this.nodeRef} />
                {this.state.error && (
                    <div class="script-editor-error">
                        <ErrorDisplay error={this.state.error} />
                    </div>
                )}
                {this.state.loading && <div class="script-editor-loading"><Progress block /></div>}
            </div>
        );
    }
}

namespace ScriptEditor {
    export interface Props {
        class?: string,
        value: string,
        onChange?: (value: string) => void,
    }
}
