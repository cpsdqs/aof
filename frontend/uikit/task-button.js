import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { globalAnimator, Spring } from './animation';
import Popout from './popout';
import './task-button.less';

/// - run: () => Promise<?>
/// - loading: external loading state. Can be used to force loading animation
export default class TaskButton extends PureComponent {
    state = {
        loading: false,
        popoutOpen: false,
        popoutMessage: null,
        popoutAction: null,
    };

    #loading = new Spring(1, 0.3);
    #width = new Spring(1, 0.3);
    #button = createRef(null);
    #circleSize;

    updateWidth = (animate) => {
        const button = this.#button.current;
        if (!button) return;

        const originalStyleWidth = button.style.width;
        button.style.width = '';
        this.#width.target = button.offsetWidth;
        button.style.width = originalStyleWidth;

        if (!animate) this.#width.finish();

        if (this.#width.wantsUpdate()) globalAnimator.register(this);
    };

    get loading() {
        return this.state.loading || this.props.loading;
    }

    update (dt) {
        this.#loading.target = this.loading ? 1 : 0;

        this.#loading.update(dt);
        this.#width.update(dt);

        if (!this.loading && !this.#loading.wantsUpdate() && !this.#width.wantsUpdate()) {
            this.#loading.finish();
            this.#width.finish();
            globalAnimator.deregister(this);
        }

        this.forceUpdate();
    }

    componentDidMount() {
        globalAnimator.register(this);
        this.updateMetrics(true);
    }

    componentDidUpdate(prevProps) {
        if (this.props.loading !== prevProps.loading) {
            globalAnimator.register(this);

            if (this.props.loading) {
                this.setState({ popoutOpen: false });
            }
        }
        if (this.props.loading !== prevProps.loading || this.props.children !== prevProps.children) {
            this.updateMetrics();
        }
    }

    componentWillUnmount() {
        globalAnimator.deregister(this);
    }

    showError(error, action) {
        this.setState({ popoutOpen: true, popoutMessage: error, popoutAction: action || null });
    }

    showAction(label, run) {
        this.setState({
            popoutOpen: true,
            popoutMessage: null,
            popoutAction: {
                label,
                run: () => this.setState({ loading: true, popoutOpen: false }, () => {
                    globalAnimator.register(this);
                    run().catch(error => {
                        this.showError(error);
                    }).then(() => this.setState({ loading: false }, () => this.updateMetrics()));
                }),
            },
        });
    }

    updateMetrics(skipAnimation) {
        this.#circleSize = this.#button.current.offsetHeight;
        this.updateWidth(!skipAnimation);
    }

    run = (e) => {
        if (this.loading) return;
        this.setState({ popoutOpen: false });
        this.updateMetrics();

        this.setState({ loading: true }, () => {
            globalAnimator.register(this);

            this.props.run(e).catch(error => {
                console.error('TaskButton error', error);
                this.showError(error);
            }).then(() => {
                this.setState({ loading: false }, () => this.updateMetrics());
            });
        });
    };

    onClick = e => {
        if (this.props.onClick) this.props.onClick(e);
        this.run();
    };

    render ({
        class: pClassName,
        disabled,
        children
    }) {
        const l = this.#loading.value;
        const taskButtonWidth = l
            ? (this.#circleSize - this.#width.value) * l + this.#width.value
            : null;

        let className = 'task-button ';
        if (l > 0.1) className += 'is-loading ';
        if (disabled) className += 'is-disabled ';
        className += pClassName || '';

        let buttonStyle = {};
        if (this.#width.value !== this.#width.target) {
            buttonStyle.width = this.#width.value;
        }

        return (
            <span class={className}>
                <button
                    ref={this.#button}
                    style={buttonStyle}
                    disabled={disabled}
                    class="task-button-inner"
                    onClick={this.onClick}>
                    {children}
                </button>
                <div class="task-button-loading" style={{
                    width: taskButtonWidth,
                }}>
                </div>
                <div class={'task-button-loading-spin' + (l > 0.9 ? ' is-visible' : '')}>
                    <div class="task-button-loading-spin-inner" style={{
                        width: this.#circleSize,
                    }} />
                </div>

                <Popout
                    location="below"
                    message={this.state.popoutMessage}
                    action={this.state.popoutAction}
                    open={this.state.popoutOpen}
                    onClose={() => this.setState({ popoutOpen: false })} />
            </span>
        );
    }
}
