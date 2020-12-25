import { h } from 'preact';
import { createPortal, PureComponent } from 'preact/compat';
import { globalAnimator, Spring, Progress, Checkbox, TaskButton } from 'uikit';
import * as Comlink from 'comlink';
import keygenWorkerURL from 'omt:./keygen-worker';
import { isNameAvailable, register, login, loginEvents } from '../api';
import './dialog.less';

function generateSecretKey(password) {
    const worker = Comlink.wrap(new Worker(keygenWorkerURL));
    return new Promise((resolve, reject) => {
        worker.generateSecretKey(password, Comlink.proxy((err, result) => {
            if (err) reject(err);
            else resolve(result);
        }));
    });
}

const portalContainer = document.createElement('div');
portalContainer.className = 'registration-portal-container';
document.body.appendChild(portalContainer);

export default class RegistrationDialog extends PureComponent {
    presence = new Spring(0.8, 0.5);

    componentDidMount() {
        globalAnimator.register(this);
    }

    componentDidUpdate(prevProps) {
        if (this.props.open !== prevProps.open) {
            this.presence.target = !!this.props.open;
            globalAnimator.register(this);
        }
    }

    componentWillUnmount() {
        globalAnimator.deregister(this);
    }

    update(dt) {
        this.presence.update(dt);
        if (!this.presence.wantsUpdate()) globalAnimator.deregister(this);
        this.forceUpdate();
    }

    render({ token, onSuccess }) {
        const presence = this.presence.value;

        if (presence < 0.01) return null;

        return createPortal(
            <div class="registration-dialog-container">
                <div
                    class="registration-dialog-backdrop"
                    onClick={this.props.onClose}
                    style={{ opacity: presence }} />
                <div class="registration-dialog" style={{
                    transform: `translateY(${((1 - presence) * 100).toFixed(3)}vh)`
                }}>
                    <button
                        class="registration-dialog-close"
                        onClick={this.props.onClose} />
                    <RegistrationForm token={token} onSuccess={onSuccess} />
                </div>
            </div>,
            portalContainer,
        );
    }
}

class RegistrationForm extends PureComponent {
    state = {
        username: '',
        password: '',
        password2: '',
        useSecretKeyPassword: false,
        skpassword: '',
        skpassword2: '',
        agreedPrivacy: false,
        agreedTerms: false,
    };

    submit = async () => {
        if (!this.state.agreedPrivacy || !this.state.agreedTerms) {
            throw new Error('Cannot create an account without agreeing to the terms');
        }
        if (this.state.password !== this.state.password2) {
            throw new Error('Passwords do not match');
        }
        let skPassword = this.state.password;
        if (this.state.useSecretKeyPassword) {
            skPassword = this.state.skpassword;
            if (this.state.skpassword !== this.state.skpassword2) {
                throw new Error('Secret key passwords do not match');
            }
        }

        const secretKey = await generateSecretKey(skPassword);
        const result = await register(this.props.token, this.state.username, this.state.password, secretKey);
        if (result.success) {
            // also log in
            const result = await login(this.state.username, this.state.password);
            loginEvents.emit('update');
            if (result.success) {
                this.props.onSuccess();
            } else {
                console.error('Failed to log in: ' + result.error);
                throw new Error('Registered, but failed to log in');
            }
        } else {
            // TODO: handle properly
            throw new Error(result.error);
        }
    };

    render({ token }) {
        const canSubmit = this.state.agreedPrivacy && this.state.agreedTerms;

        return (
            <div class="registration-form">
                <h1 class="form-title">Create Account</h1>
                <Field>
                    <Label>Username</Label>
                    <NameEditor
                        token={token}
                        value={this.state.username}
                        onChange={username => this.setState({ username })} />
                </Field>
                <Field>
                    <Label>Password</Label>
                    <PasswordEditor
                        name="password"
                        value={this.state.password}
                        onChange={password => this.setState({ password })} />
                </Field>
                <Field>
                    <Label>Confirm Password</Label>
                    <PasswordEditor
                        name="password-confirm"
                        confirm
                        other={this.state.password}
                        value={this.state.password2}
                        onChange={password2 => this.setState({ password2 })} />
                </Field>
                <Field>
                    <Label>
                        <Checkbox
                            checked={this.state.useSecretKeyPassword}
                            onChange={u => this.setState({ useSecretKeyPassword: u })} />
                        {' '}
                        Use a different password for the secret key
                    </Label>
                </Field>
                {this.state.useSecretKeyPassword && (
                    <div>
                        <Field>
                            <Label>Secret Key Password</Label>
                            <PasswordEditor
                                name="sk-password"
                                value={this.state.skpassword}
                                onChange={p => this.setState({ skpassword: p })} />
                        </Field>
                        <Field>
                            <Label>Confirm Secret Key Password</Label>
                            <PasswordEditor
                                name="sk-password-confirm"
                                confirm
                                other={this.state.skpassword}
                                value={this.state.skpassword2}
                                onChange={p => this.setState({ skpassword2: p })} />
                        </Field>
                    </div>
                )}
                <Terms
                    title="Privacy"
                    src="static/privacy.html"
                    didAgree={this.state.agreedPrivacy}
                    onAgreeChange={r => this.setState({ agreedPrivacy: r })} />
                <Terms
                    title="Terms of Use"
                    src="static/terms.html"
                    didAgree={this.state.agreedTerms}
                    onAgreeChange={r => this.setState({ agreedTerms: r })} />
                <div class="form-footer">
                    <TaskButton
                        disabled={!canSubmit}
                        run={this.submit}>
                        Submit
                    </TaskButton>
                </div>
            </div>
        );
    }
}

function Field({ children }) {
    return (
        <div class="form-field">{children}</div>
    );
}
function Label({ children }) {
    return (
        <label class="form-label">{children}</label>
    );
}

class TextField extends PureComponent {
    render ({
        value,
        onChange,
        note,
        error,
        ...extra
    }) {
        return (
            <span class="form-text-field">
                <input
                    {...extra}
                    value={value}
                    onChange={e => onChange(e.target.value)} />
                <span class={'text-field-note' + (error ? ' is-error' : '')}>
                    {error || note}
                </span>
            </span>
        );
    }
}

class NameEditor extends PureComponent {
    state = {
        availability: null,
        loading: false,
    };

    componentDidUpdate(prevProps) {
        if (this.props.value !== prevProps.value) {
            this.scheduleCheck();
        }
    }

    scheduledCheck = null;
    scheduleCheck() {
        if (this.scheduledCheck) return;
        this.setState({ availability: null });
        this.scheduledCheck = setTimeout(() => {
            this.scheduledCheck = null;
            this.check();
        }, 400);
    }

    checkLock = 0;
    check() {
        const lock = ++this.checkLock;
        this.setState({ loading: true });
        isNameAvailable(this.props.token, this.props.value).then(availability => {
            if (lock !== this.checkLock) return;
            this.setState({ availability, loading: false });
        }).catch(err => {
            if (lock !== this.checkLock) return;
            const availability = { available: false, error: err.toString() };
            this.setState({ availability, loading: false });
        });
    }

    render({ value, onChange }) {
        let error, note;
        if (!this.state.availability) {
            if (this.state.loading) note = 'Checking availability…';
        } else {
            const { available, error: availabilityError } = this.state.availability;
            if (available) {
                note = 'Name is available';
            } else {
                if (availabilityError === 'invalid_name') {
                    const byteLength = new TextEncoder().encode(this.props.value).length;
                    if (byteLength < 4) error = 'Name is too short';
                    else if (byteLength > 32) error = 'Name is too long';
                    else error = 'Name can only contain letters or numbers';
                } else {
                    const errors = {
                        invalid_token: 'Registration token has expired',
                        name_taken: 'Name is not available',
                        network_error: 'Failed to check availability',
                    };
                    error = errors[availabilityError] || availabilityError;
                }
            }
        }

        return (
            <TextField
                name="username"
                value={value}
                note={note}
                error={error}
                onChange={onChange} />
        );
    }
}
class PasswordEditor extends PureComponent {
    state = {
        didInput: false,
    };

    render({ value, onChange, name }) {
        let error;
        if (this.state.didInput && this.props.confirm) {
            if (this.props.value !== this.props.other) {
                error = 'Passwords do not match';
            }
        }

        return (
            <TextField
                type="password"
                name={name}
                onBlur={() => this.setState({ didInput: true })}
                value={value}
                onChange={onChange}
                error={error} />
        );
    }
}

class Terms extends PureComponent {
    state = {
        open: false,
        didAgreeOnce: false,
    };

    render() {
        return (
            <div class="terms">
                <div class="terms-header">
                    <button class="disclosure" onClick={() => this.setState({ open: !this.state.open })}>
                        <span class={'disclosure-indicator' + (this.state.open ? ' is-open' : '')}>
                            <span class="di-a" />
                            <span class="di-b" />
                        </span>
                        {this.props.title}
                    </button>
                    {this.state.didAgreeOnce && (
                        <Checkbox
                            class="header-check"
                            checked={this.props.didAgree}
                            onChange={this.props.onAgreeChange} />
                    )}
                </div>
                {this.state.open && <TermsContents
                    src={this.props.src}
                    didAgree={this.props.didAgree}
                    onAgreeChange={a => {
                        this.props.onAgreeChange(a);
                        if (a) this.setState({ didAgreeOnce: true });
                    }} />}
            </div>
        )
    }
}

class TermsContents extends PureComponent {
    state = {
        contents: null,
        error: null,
    };

    load() {
        fetch(this.props.src).then(res => res.text()).then(contents => {
            this.setState({ contents });
        }).catch(error => this.setState({ error }));
    }

    componentDidMount() {
        this.load();
    }

    render({ didAgree, onAgreeChange }) {
        if (this.state.error) return <div>{this.state.error.toString()}</div>;
        if (!this.state.contents) return <Progress block />;

        const agreementId = Math.random().toString(36);

        return (
            <div class="terms-contents">
                <div
                    class="dangerous-html"
                    dangerouslySetInnerHTML={{ __html: this.state.contents }} />
                <div class="terms-footer">
                    <Checkbox
                        class="terms-agreement-check"
                        id={agreementId}
                        checked={didAgree}
                        onChange={onAgreeChange} />
                    <label for={agreementId}>
                        I agree to these terms
                    </label>
                </div>
            </div>
        );
    }
}
