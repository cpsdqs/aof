import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { globalAnimator } from './animation';
import './progress.less';

export default class ProgressIndicator extends PureComponent {
    render ({ block, lines }) {
        if (block) return (
            <div class="progress-indicator-block">
                <ProgressLines lines={lines || 8} />
            </div>
        );

        return (
            <span class="progress-indicator">
                <ProgressLines small lines={lines || 8} />
            </span>
        );
    }
}

const progressCurve = x => Math.exp(-20 * x) + (x * x);

class ProgressLines extends PureComponent {
    #spin = 0;
    update (dt) {
        if (globalAnimator.animationSpeed > 50) return;
        this.#spin = (this.#spin + dt) % 1;

        this.forceUpdate();
    }

    componentDidMount () {
        globalAnimator.register(this);
    }

    componentWillUnmount () {
        globalAnimator.deregister(this);
    }

    render ({ small, lines: lineCount }) {
        const lines = [];
        for (let i = 0; i < lineCount; i++) {
            let adjustedSpin = this.#spin * lineCount;
            if (adjustedSpin > i) {
                adjustedSpin -= lineCount;
            }
            const dist = i - adjustedSpin;
            const t = (dist / lineCount);
            const tt = progressCurve(t);

            const transform = `translate(var(--pxoffset), var(--pxoffset)) rotate(${360 * i / lineCount}deg) translateX(var(--line-offset))`;
            const opacity = tt * 0.8 + 0.2;
            lines.push(
                <span class="progress-line" style={{ transform, opacity }} />
            );
        }

        let className = 'progress-indicator-lines';
        if (small) className += ' is-small';

        return (
            <span class={className}>
                {lines}
            </span>
        );
    }
}
