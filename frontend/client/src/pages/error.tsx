import { h } from 'preact';
import get from '../locale';
import './error.less';

export default function ErrorPage() {
    return (
        <div class="error-page">
            {get('error.generic')}
        </div>
    );
}
