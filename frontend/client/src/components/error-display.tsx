import { h } from 'preact';
import './error-display.less';

export default function ErrorDisplay({ error }: ErrorDisplay.Props) {
    if (!error) return null;

    return (
        <span class="error-display">
            {error.toString()}
        </span>
    );
}

namespace ErrorDisplay {
    export interface Props {
        error: any,
    }
}
