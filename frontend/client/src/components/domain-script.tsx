import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { connectf, DOMAIN_SCRIPT, join } from '../data';
import { Progress } from 'uikit';
import ScriptEditor from './script-editor';
import './domain-script.less';

export default class DomainScript extends PureComponent<DomainScript.Props> {
    render({ id }: DomainScript.Props) {
        return connectf(join(DOMAIN_SCRIPT, id), view => {
            const script = view.get();

            let contents;
            if (view.loaded) {
                contents = (
                    <ScriptEditor
                        class="domain-script-inner"
                        value={script || ''} />
                );
            } else if (view.hasError) {
                const error = view.getError();
                contents = (
                    'todo error'
                );
            } else {
                contents = (
                    <Progress block />
                );
            }

            return (
                <div class="domain-script">
                    {contents}
                </div>
            );
        });
    }
}

namespace DomainScript {
    export interface Props {
        id: string,
    }
}
