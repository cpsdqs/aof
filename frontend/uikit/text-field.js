import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import './text-field.less';

export default class TextField extends PureComponent {
    state = {
        focused: false,
    };

    input = createRef(null);

    onFocus = (e) => {
        this.setState({ focused: true });
        if (this.props.onFocus) this.props.onFocus(e);
    };

    onBlur = (e) => {
        this.setState({ focused: false });
        if (this.props.onBlur) this.props.onBlur(e);
    };

    focus() {
        this.input.current.focus();
    }

    render({ class: pClassName, value, onChange, ...extra }) {
        let className = 'text-field ';
        if (this.state.focused) className += ' is-focused';
        className += pClassName || '';

        return (
            <span class={className}>
                <input
                    autocomplete="off" // default this to off because you’d rarely ever want this
                    {...extra}
                    ref={this.input}
                    value={value}
                    onChange={e => {
                        onChange(e.target.value);
                    }}
                    onFocus={this.onFocus}
                    onBlur={this.onBlur}
                    class="p-inner-field" />
            </span>
        );
    }
}
