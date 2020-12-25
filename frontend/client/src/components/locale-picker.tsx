import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import get, { current, availableLocales } from '../locale';

export default class LocalePicker extends PureComponent {
    render() {
        return (
            <div class="locale-picker">
                <select
                    value={current.get()}
                    onChange={e => {
                        const value = (e.target as HTMLSelectElement).value;
                        if (value) current.set(value);
                    }}>
                    {availableLocales.map(id => (
                        <option key={id} value={id}>
                            {get(`locales.${id}`)}
                        </option>
                    ))}
                </select>
            </div>
        );
    }
}
