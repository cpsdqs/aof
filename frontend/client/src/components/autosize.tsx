import { h, ComponentChildren } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { globalAnimator, Spring } from 'uikit';

export default class Autosize extends PureComponent<Autosize.Props> {
    height = new Spring(1, 0.5);
    node = createRef();

    updateHeight = (animate: boolean) => {
        if (!this.node.current) return;
        const node = this.node.current!;

        this.height.target = [...node.children]
            .map((child: HTMLElement) => child.offsetHeight)
            .reduce((a: number, b: number) => a + b, 0);

        if (!animate) {
            this.height.value = this.height.target;
        }

        if (this.height.wantsUpdate()) globalAnimator.register(this);
    };

    update(dt: number) {
        this.height.update(dt);

        if (!this.height.wantsUpdate()) globalAnimator.deregister(this);
        this.forceUpdate();
    }

    componentDidMount() {
        globalAnimator.register(this);
        this.updateHeight(false);
        window.addEventListener('resize', this.onWindowResize);
    }

    componentDidUpdate(prevProps: Autosize.Props) {
        if (prevProps.children !== this.props.children) this.updateHeight(true);
    }

    onWindowResize = () => this.updateHeight(true);

    componentWillUnmount() {
        globalAnimator.deregister(this);
        window.removeEventListener('resize', this.onWindowResize);
    }

    render({ component, children, ...props }: Autosize.Props) {
        return h(component, {
            ref: this.node,
            style: this.height.wantsUpdate() ? { height: this.height.value } : null,
            ...props,
        }, children);
    }
}

namespace Autosize {
    export interface Props {
        component: any,
        children: ComponentChildren,
        [k: string]: any,
    }
}
