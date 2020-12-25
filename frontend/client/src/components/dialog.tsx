import { h, ComponentChild, ComponentChildren } from 'preact';
import { createPortal, PureComponent } from 'preact/compat';
import { Spring, globalAnimator } from 'uikit';
import './dialog.less';

export default class Dialog extends PureComponent<Dialog.Props> {
    portalContainer = document.createElement('div');
    presence = new Spring(1, 0.3);

    constructor(props: Dialog.Props) {
        super(props);

        this.portalContainer.classList.add('dialog-portal');
    }

    componentDidMount() {
        globalAnimator.register(this);
    }

    componentDidUpdate(prevProps: Dialog.Props) {
        if (prevProps.open !== this.props.open) {
            globalAnimator.register(this);
        }
    }

    componentWillUnmount() {
        globalAnimator.deregister(this);
        this.unmountPortal();
    }

    mountPortal() {
        if (!this.portalContainer.parentNode) {
            document.body.appendChild(this.portalContainer);
        }
    }
    unmountPortal() {
        if (this.portalContainer.parentNode) {
            this.portalContainer.parentNode.removeChild(this.portalContainer);
            if (this.props.onUnmount) this.props.onUnmount();
        }
    }

    update(dt: number) {
        this.presence.target = this.props.open ? 1 : 0;
        this.presence.update(dt);

        if (this.presence.value > 0.01) this.mountPortal();
        else this.unmountPortal();

        const wantsUpdate = this.presence.wantsUpdate();

        if (!wantsUpdate) {
            this.presence.finish();
            globalAnimator.deregister(this);
        }

        this.forceUpdate();
    }

    render() {
        const presence = this.presence.value;

        let backdrop = null;
        let dialog = null;
        if (presence > 0.01) {
            backdrop = (
                <div
                    style={{ opacity: presence }}
                    onClick={this.props.onClose}
                    class="dialog-backdrop" />
            );

            let closeButton;
            if (this.props.closeButton) {
                closeButton = <button
                    class="dialog-close-button"
                    onClick={this.props.onClose} />;
            }

            dialog = (
                <div
                    style={{
                        opacity: presence,
                        transform: `translateY(${(1 - presence) * -40}px)`
                    }}
                    class={'dialog ' + (this.props.class || '')}>
                    {(this.props.title || closeButton) && (
                        <div class="dialog-title">
                            {closeButton}
                            <div class="title-contents">
                                {this.props.title}
                            </div>
                        </div>
                    )}
                    <div class="dialog-contents">
                        {this.props.children}
                    </div>
                    {(this.props.destroy || this.props.cancel || this.props.confirm) && (
                        <div class="dialog-action-buttons">
                            <div class="button-group">
                                {this.props.destroy}
                            </div>
                            <div class="button-group">
                                {this.props.cancel}
                                <span class="button-spacer" />
                                {this.props.confirm}
                            </div>
                        </div>
                    )}
                </div>
            );
        }


        return createPortal(
            <div class="dialog-portal-inner">
                {backdrop}
                {dialog}
            </div>,
            this.portalContainer,
        );
    }
}

namespace Dialog {
    export interface Props {
        open?: boolean,
        class?: string,
        closeButton?: boolean,
        onClose?: () => void,
        onUnmount?: () => void,
        title?: ComponentChild,
        children?: ComponentChildren,
        destroy?: ComponentChild,
        cancel?: ComponentChild,
        confirm?: ComponentChild,
    }
}

export function DialogContents({ children }: { children: ComponentChildren }) {
    return (
        <div class="dialog-inner-contents">
            {children}
        </div>
    );
}
