import { h, ComponentChild, ComponentChildren } from 'preact';
import { PureComponent } from 'preact/compat';
import { AnimationTarget, globalAnimator, Spring } from 'uikit';
import './page-stack.less';

// FIXME: is there no better way of getting these?
const measure = document.createElement('div');
measure.className = 'measure-css-env-variables';
document.body.appendChild(measure);
measure.style.left = 'env(safe-area-inset-left)';
measure.style.right = 'env(safe-area-inset-right)';

let safeAreaInsetLeft = 0;
let safeAreaInsetRight = 0;
function updateSafeAreaInsets() {
    const cs = getComputedStyle(measure);
    safeAreaInsetLeft = parseFloat(cs.left);
    safeAreaInsetRight = parseFloat(cs.right);
}
updateSafeAreaInsets();

export default class PageStack extends PureComponent<PageStack.Props> implements AnimationTarget {
    onResize = () => {
        updateSafeAreaInsets();

        globalAnimator.register(this);
        setTimeout(() => {
            globalAnimator.register(this);
        }, 50);
    };

    #depth = new Spring(1, 0.5);
    #deadChildren: ComponentChild[] = [];

    componentDidMount() {
        window.addEventListener('resize', this.onResize);
        globalAnimator.register(this);
    }

    update(dt: number) {
        const { minDepth } = this.getMapping();
        this.#depth.target = Math.max(minDepth, this.props.children.length - 1);
        this.#depth.update(dt);

        const maxVisibleDepth = Math.ceil(this.#depth.value);
        if (this.#deadChildren.length > maxVisibleDepth + 1) this.#deadChildren.splice(maxVisibleDepth);

        if (!this.#depth.wantsUpdate()) {
            this.#depth.target = this.props.children.length - 1;
            this.#depth.finish();
            globalAnimator.deregister(this);
        }

        this.forceUpdate();
    }

    componentDidUpdate(prevProps: PageStack.Props) {
        if (prevProps.children.length !== this.props.children.length) {
            globalAnimator.register(this);
        }
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.onResize);
        globalAnimator.deregister(this);
    }

    getMapping() {
        // compute column location
        let mapping;
        let minDepth = 0;
        if (window.innerWidth >= 1300) {
            mapping = [
                { pos: -3, span: [-0.2, 0.2] },
                { pos: -2, span: [0, 0.2] },
                { pos: -1, span: [0.2, 0.3] },
                { pos: 0,  span: [0.5, 0.5] },
                { pos: 1,  span: [1, 0.5] },
            ];
            minDepth = 2;
        } else if (window.innerWidth >= 900) {
            mapping = [
                { pos: -2, span: [-0.4, 0.4] },
                { pos: -1, span: [0, 0.4] },
                { pos: 0, span: [0.4, 0.6] },
                { pos: 1, span: [1, 0.6] },
            ];
            minDepth = 1;
        } else {
            mapping = [
                { pos: -1, span: [-1, 1] },
                { pos: 0, span: [0, 1] },
                { pos: 1, span: [1, 1] },
            ];
        }

        return { minDepth, mapping };
    }

    renderColumn(i: number, contents: ComponentChildren, isDead?: boolean) {
        const width = window.innerWidth - safeAreaInsetLeft - safeAreaInsetRight;

        const { minDepth, mapping } = this.getMapping();
        const depth = isDead ? this.#depth.value : Math.max(minDepth, this.#depth.value);

        const getMapped = (x: number) => {
            const fract = x - Math.floor(x);
            let prev = mapping[0].span;
            for (const { pos, span } of mapping) {
                if (pos > x) return [
                    (span[0] - prev[0]) * fract + prev[0],
                    (span[1] - prev[1]) * fract + prev[1],
                ];
                prev = span;
            }
            return prev;
        };

        const res = getMapped(i - depth);
        const x = safeAreaInsetLeft + res[0] * width;
        const columnWidth = res[1] * width;

        const style = {
            transform: `translateX(${x}px)`,
            width: columnWidth,
        };

        return (
            <div class="page-stack-column" style={style}>
                {contents}
            </div>
        );
    }

    render({ children }: PageStack.Props) {
        const columns = [];

        let i = 0;
        for (const child of children) {
            if (this.#deadChildren.length <= i) this.#deadChildren.push(child);
            columns.push(this.renderColumn(i, child));
            i++;
        }
        for (; i < this.#deadChildren.length; i++) {
            const dc = this.#deadChildren[i];
            columns.push(this.renderColumn(i, dc, true));
        }

        return (
            <div class="page-stack">
                {columns}
            </div>
        );
    }
}

namespace PageStack {
    export interface Props {
        children: ComponentChild[],
    }
}
