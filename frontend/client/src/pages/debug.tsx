import { h, Component, VNode } from 'preact';
import { Checkbox, Progress, TextField, TaskButton, globalAnimator } from 'uikit';
import { load, __cache_debug, AOFC_KEY_STORAGE, AOFC_SESSION, AOFC_SESSION_STATE } from '../data';
import { req } from '../data/socket';
import * as aofc from '../data/aofc';

function state(render: (v: any, c: (v: any) => any) => VNode, value: any, map?: (v: any) => any) {
    class State extends Component {
        state = {
            value,
        };
        render() {
            return render(this.state.value, v => this.setState({ value: (map ? map(v) : v) }));
        }
    }
    return <State />;
}

function exposeAPI() {
    // @ts-ignore
    window.aof = {
        load,
        req,
        cache: __cache_debug,
        aofc,
    };
}

async function regenClientKey() {
    if (confirm('Are you sure you want to regenerate your client key?\nYou will need to re-enter your secret key on all devices.')) {
        await req('user_regen_client_key', null);
    }
}

async function testDecrypt() {
    try {
        delete sessionStorage[AOFC_KEY_STORAGE];
    } catch (err) {}
    try {
        delete localStorage[AOFC_KEY_STORAGE];
    } catch (err) {}
    __cache_debug.cache.delete(AOFC_SESSION);
    __cache_debug.cache.delete(AOFC_SESSION_STATE);
    let nonce = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let enc = await aofc.encrypt(nonce, new Uint8Array([0]));
    let res = await aofc.decrypt(nonce, enc);
    if (res.length !== 1 || res[0] !== 0) throw new Error('Unexpected result!');
}

export default function DebugPage() {
    return (
        <div class="debug-page">
            <h2>API</h2>
            <TaskButton run={async () => exposeAPI()}>expose window.aof</TaskButton>
            <TaskButton run={regenClientKey}>regen client key</TaskButton>
            <TaskButton run={testDecrypt}>show decryption prompt</TaskButton>
            <h2>Global Animator</h2>
            <button onClick={() => globalAnimator.stop()}>stop</button>
            <button onClick={() => globalAnimator.start()}>start</button>
            <button onClick={() => globalAnimator.animationSpeed = 0.2}>speed x0.2</button>
            <button onClick={() => globalAnimator.animationSpeed = 0.5}>speed x0.5</button>
            <button onClick={() => globalAnimator.animationSpeed = 1}>speed x1</button>
            <button onClick={() => globalAnimator.animationSpeed = 2}>speed x2</button>
            <button onClick={() => globalAnimator.animationSpeed = 5}>speed x5</button>
            <button onClick={() => globalAnimator.animationSpeed = 1000}>no motion</button>
            <h2>Progress</h2>
            <Progress block />
            <Progress lines={4} />
            <Progress lines={6} />
            <Progress />
            <Progress lines={12} />
            <Progress lines={32} />
            <h2>Checkbox</h2>
            {state((v, c) => <Checkbox checked={v} onChange={c} />, false)}
            <Checkbox disabled checked />
            <Checkbox disabled />
            <h2>Text Field</h2>
            {state((v, c) => <TextField value={v} onChange={c} />, 'meow')}
            <TextField disabled value="test" onChange={() => {}} />
            <h2>Task Button</h2>
            <TaskButton run={() => new Promise(r => setTimeout(r, 1000))}>
                Success
            </TaskButton>
            {' '}
            <TaskButton run={() => new Promise((r, j) => {
                setTimeout(() => j(new Error('meow')), 1000);
            })}>
                Failure
            </TaskButton>
            <TaskButton run={async () => {}} loading>Force Load</TaskButton>
        </div>
    );
}
