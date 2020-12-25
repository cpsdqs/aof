import { h } from 'preact';
import { createRef, createPortal, PureComponent } from 'preact/compat';
import { globalAnimator, Spring } from './animation';
import './popout.less';

const popoutContainer = document.createElement('div');
popoutContainer.className = 'popout-container';
document.body.appendChild(popoutContainer);

/// Renders a popout that will eventually disappear.
/// Will magically appear positioned around the parent node.
///
/// # Props
/// - message: message to display (can be an error)
/// - open/onClose: open state
/// - location: 'above' or 'below'
/// - action: optional { run, label }
export default class Popout extends PureComponent {
    state = {
        expanded: false,
    };

    anchor = createRef();

    render() {
        return (
            <span class="popout-anchor" ref={this.anchor}>
                <InnerPopout
                    location={this.props.location}
                    open={this.props.open}
                    onClose={this.props.onClose}
                    anchor={this.anchor}
                    message={this.props.message}
                    action={this.props.action} />
            </span>
        );
    }
}

const POPOUT_CLOSE_TIMEOUT = 2500;

class InnerPopout extends PureComponent {
    componentDidMount() {
        globalAnimator.register(this);
    }
    componentWillUnmount() {
        clearTimeout(this.scheduledClose);
        globalAnimator.deregister(this);
    }

    presence = new Spring(1, 0.3);
    presenceY = new Spring(0.5, 0.3);
    presenceOut = 0;
    position = null;
    containerWidth = null;
    popoutOffsetX = null;
    pointerSize = 0;

    popoutContainer = createRef();
    popoutPointer = createRef();

    updatePosition() {
        const location = this.props.location || 'below';
        const anchor = this.props.anchor.current;
        const popoutContainer = this.popoutContainer.current;
        if (anchor && anchor.parentNode && popoutContainer) {
            const parent = anchor.parentNode;
            const anchorRect = parent.getBoundingClientRect();

            let anchorLeft = anchorRect.left;
            let anchorTop = anchorRect.top;

            if (window.visualViewport) {
                anchorLeft += window.visualViewport.offsetLeft;
                anchorTop += window.visualViewport.offsetTop;
            }

            let px = anchorLeft + anchorRect.width / 2;
            let py = anchorTop + anchorRect.height;

            if (location === 'above') {
                py = anchorTop;
            }

            this.position = [px, py];

            this.pointerSize = this.popoutPointer.current.offsetWidth;

            this.containerWidth = popoutContainer.offsetWidth;
            const minOffset = -px;
            const maxOffset = window.innerWidth - this.containerWidth - px;
            this.popoutOffsetX = Math.max(minOffset, Math.min(-this.containerWidth / 2, maxOffset));
        }
    }

    update(dt) {
        if (this.props.open) {
            this.presence.target = 1;
            this.presenceY.target = 1;
        }
        this.presence.update(dt);
        this.presenceY.update(dt);

        let presenceOutWantsUpdate;
        if (this.props.open) {
            this.presenceOut = Math.max(0, this.presenceOut - dt / 0.5);
            presenceOutWantsUpdate = this.presenceOut > 0;
        } else {
            this.presenceOut = Math.min(1, this.presenceOut + dt / 0.5);
            presenceOutWantsUpdate = this.presenceOut < 1;
        }

        this.updatePosition();

        const wantsUpdate = this.presence.wantsUpdate()
            || this.presenceY.wantsUpdate()
            || presenceOutWantsUpdate;

        if (!this.props.open && !wantsUpdate) {
            globalAnimator.deregister(this);
            this.presenceOut = 0;
            this.presence.value = 0;
            this.presenceY.value = 0;
        }
        this.forceUpdate();
    }

    didOpen() {
        this.presence.value = 0;
        this.presenceY.value = 0;
    }
    didClose() {
        clearTimeout(this.scheduledClose);
        this.presenceOut = 0;
    }

    componentDidUpdate(prevProps) {
        if (this.props.open !== prevProps.open) {
            globalAnimator.register(this);
            if (this.props.open) {
                this.didOpen();
                this.scheduleClose();
            } else {
                this.didClose();
            }
        }
    }

    scheduledClose;
    scheduleClose() {
        clearTimeout(this.scheduledClose);
        this.scheduledClose = setTimeout(() => {
            this.props.onClose();
        }, POPOUT_CLOSE_TIMEOUT);
    }

    render() {
        const presence = this.presence.value;
        const presenceY = this.presenceY.value;
        const presenceOut = this.presenceOut;
        if (presence < 0.01 || presenceOut === 1) return null;

        const outScale = 1 - Math.pow(presenceOut, 6);

        const scaleY = presenceY * outScale;
        const scaleX = Math.pow(presence, 3) * outScale;

        let transform = null;
        let opacity = 0;
        if (this.position) {
            transform = [
                `translate(${this.position[0]}px, ${this.position[1]}px)`,
                `scaleY(${scaleY.toFixed(3)})`,
            ].join(' ');

            opacity = Math.sqrt(presence) * outScale;
        }

        const pointerBaseSize = this.pointerSize;
        let pointerSize = Math.min(scaleX * this.containerWidth, pointerBaseSize);

        let cx = this.popoutOffsetX || 0;
        let py = 0;
        let ps = pointerSize / pointerBaseSize;
        let cy = py + Math.sqrt(2) / 2 * pointerSize;

        const pointerTransform = [
            `translateY(${py.toFixed(3)}px)`,
            `rotate(45deg)`,
            `scale(${ps.toFixed(3)})`,
        ].join(' ');

        const containerTransform = [
            `translate(${cx.toFixed(3)}px, ${cy.toFixed(3)}px)`,
            `scaleX(${scaleX.toFixed(3)})`,
        ].join(' ');
        const containerOrigin = `${(-cx).toFixed(3)}px 0`;

        const popout = (
            <div
                class="popout-satellite"
                style={{
                    transform,
                    opacity,
                }}>
                <div class="popout-pointer"
                     ref={this.popoutPointer}
                    style={{
                        transform: pointerTransform,
                    }} />
                <div
                    class="popout-container"
                    ref={this.popoutContainer}
                    style={{
                        transform: containerTransform,
                        transformOrigin: containerOrigin,
                    }}>
                    <div class="popout-contents">
                        <button class="popout-close" onClick={this.props.onClose}>
                            <span class="popout-close-icon" />
                        </button>
                        <div class="popout-text">
                            <MessageRenderer message={this.props.message} />
                        </div>
                        {this.props.action && (
                            <div class="popout-action">
                                <button class="popout-action-button" onClick={this.props.action.run}>
                                    {this.props.action.label}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )

        return createPortal(
            popout,
            popoutContainer,
        );
    }
}

function MessageRenderer ({ message }) {
    if (!message) return null;
    if (message.message) return message.message.toString();
    return message.toString();
}
