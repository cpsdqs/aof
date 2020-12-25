//! Decryption password prompt.
import { h, render } from 'preact';
import { PureComponent, useState, useRef } from 'preact/compat';
import { Checkbox, TaskButton, TextField } from 'uikit';
import Dialog from './dialog';
import { Form, FormItem } from './form';
import get from '../locale';
import './decryption-prompt.less';
import Autosize from './autosize';

interface HeadlessProps {
    run: (password: string, persistence: string) => Promise<void>,
    onClose: (success: boolean) => void,
}

class Headless extends PureComponent<HeadlessProps> {
    state = {
        open: false,
    };

    componentDidMount() {
        this.setState({ open: true });
    }

    onClose = (success: boolean) => {
        this.setState({ open: false });
        setTimeout(() => {
            this.props.onClose(success);
        }, 1000);
    };

    render() {
        return (
            <DecryptionPrompt
                open={this.state.open}
                onClose={success => this.onClose(success)}
                run={this.props.run} />
        );
    }
}

export default class DecryptionPrompt extends PureComponent<DecryptionPrompt.Props> {
    render() {
        return (
            <Dialog
                class="decryption-prompt-dialog"
                title={get('login.decrypt.title')}
                open={this.props.open}
                onClose={() => this.props.onClose(false)}>
                <InnerDialog
                    onClose={this.props.onClose}
                    run={this.props.run} />
            </Dialog>
        )
    }

    static run(run: (pw: string, p: string) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const mount = document.createElement('div');
            mount.className = 'decryption-prompt-dialog-mount';
            const onClose = (success: boolean) => {
                mount.remove();
                if (success) resolve();
                else {
                    const error = new Error(get('login.decrypt.errors.canceled'));
                    error.name = 'user_canceled';
                    reject(error);
                }
            };
            document.body.appendChild(mount);
            render(<Headless run={run} onClose={onClose} />, mount);
        });
    }
}

namespace DecryptionPrompt {
    export interface Props {
        open: boolean,
        onClose: (success: boolean) => void,
        run: (pw: string, persistence: string) => Promise<void>,
    }
}

function InnerDialog({ onClose, run }: { onClose: (s: boolean) => void, run: (a: string, b: string) => Promise<void> }) {
    const [password, setPassword] = useState('');
    const [persist, setPersist] = useState(false);
    const [persistSession, setPersistSession] = useState(true);
    const confirmButton = useRef<TaskButton>();

    return (
        <Form>
            <div class="prompt-description">
                {get('login.decrypt.description')}
            </div>
            <FormItem stack label={get('login.decrypt.password_label')}>
                <TextField
                    onKeyDown={e => {
                        if (e.key === 'Enter') confirmButton.current.run();
                    }}
                    type="password"
                    value={password}
                    onChange={setPassword} />
            </FormItem>
            <div class="prompt-persist">
                <Checkbox
                    id="decryption-prompt-persist"
                    checked={persist}
                    onChange={setPersist} />
                <label class="persist-label" for="decryption-prompt-persist">
                    {get('login.decrypt.persistence.label')}
                </label>
            </div>
            <Autosize component={'div'}>
                {persist && (
                    <div class="prompt-persist-session">
                        <Checkbox
                            id="decryption-prompt-persist-session"
                            checked={persistSession}
                            onChange={setPersistSession} />
                        <label class="persist-session-label" for="decryption-prompt-persist-session">
                            {get('login.decrypt.persistence.only_session')}
                        </label>
                    </div>
                )}
            </Autosize>
            <div class="prompt-persist-bottom-padding" />
            <div class="prompt-buttons">
                <TaskButton run={async () => onClose(false)}>
                    {get('login.decrypt.cancel')}
                </TaskButton>
                <TaskButton ref={confirmButton} run={async () => {
                    await run(password, !persist ? 'none' : persistSession ? 'session' : 'local');
                    onClose(true);
                }}>
                    {get('login.decrypt.confirm')}
                </TaskButton>
            </div>
        </Form>
    );
}
