import { h } from 'preact';
import { useState, PureComponent } from 'preact/compat';
import Dialog, { DialogContents } from './dialog';
import get from '../locale';
import {
    connect,
    IRssAuthKey,
    load,
    RSS_AUTH_KEY_CREATE,
    RSS_AUTH_KEY_DELETE,
    RSS_AUTH_KEY_LIST_USER
} from '../data';
import { Progress, TaskButton, TextField } from 'uikit';
import ErrorDisplay from './error-display';
import { AddIcon } from './icons';
import './rss-auth-keys.less';
import { Form, FormDescription, FormItem } from './form';

export default class RssAuthKeys extends PureComponent<RssAuthKeys.Props> {
    render() {
        return (
            <Dialog
                class="rss-auth-keys-dialog"
                title={get(this.props.onSelect
                    ? 'rss_auth_keys.dialog.title_pick'
                    : 'rss_auth_keys.dialog.title')}
                open={this.props.open}
                closeButton
                onClose={this.props.onClose}>
                <RssAuthKeysInner
                    onSelect={this.props.onSelect} />
            </Dialog>
        );
    }
}
namespace RssAuthKeys {
    export interface Props {
        open: boolean,
        onSelect?: (key: IRssAuthKey) => void,
        onClose: () => void,
    }
}

function RssAuthKeysInner({ onSelect }: { onSelect?: (key: IRssAuthKey) => void }) {
    const [deleting, setDeleting] = useState(false);
    const [selected, setSelected] = useState<IRssAuthKey | null>(null);

    return connect(RSS_AUTH_KEY_LIST_USER, view => {
        let items = [];
        if (view.loaded) {
            for (const item of view.get()!) {
                items.push(
                    <RssAuthKeyItem
                        key={item.key}
                        data={item}
                        selected={selected?.key === item.key}
                        onSelect={onSelect && (() => setSelected(item))}
                        deletable />
                );
            }
            if (!items.length) {
                items.push(
                    <div class="no-keys-notice" key={0}>
                        {get('rss_auth_keys.dialog.empty')}
                    </div>
                );
            }
        } else if (view.hasError) {
            items.push(<ErrorDisplay error={view.getError()} />);
        } else {
            items.push(<Progress key={0} block />);
        }

        return (
            <DialogContents>
                <div class="rss-key-list">
                    {items}
                </div>
                <div class="list-actions">
                    <CreateKey />
                    {onSelect ? (
                        <TaskButton disabled={!selected} run={async () => onSelect(selected!)}>
                            {get('rss_auth_keys.dialog.select_key')}
                        </TaskButton>
                    ) : <span />}
                </div>
            </DialogContents>
        )
    });
}

function CreateKey() {
    const [creating, setCreating] = useState(false);
    const [label, setLabel] = useState('');

    const create = async () => {
        await load(RSS_AUTH_KEY_CREATE, { label: label || null });
        setCreating(false);
    };

    return (
        <TaskButton run={async () => setCreating(true)}>
            <AddIcon />

            <Dialog
                title={get('rss_auth_keys.dialog.create.title')}
                open={creating}
                onClose={() => setCreating(false)}
                destroy={<TaskButton run={async () => setCreating(false)}>
                    {get('rss_auth_keys.dialog.create.cancel')}
                </TaskButton>}
                confirm={<TaskButton run={create}>
                    {get('rss_auth_keys.dialog.create.confirm')}
                </TaskButton>}>
                <DialogContents>
                    <Form>
                        <FormDescription>
                            {get('rss_auth_keys.dialog.create.description')}
                        </FormDescription>
                        <FormItem stack label={get('rss_auth_keys.dialog.create.label')}>
                            <TextField
                                value={label}
                                onChange={setLabel}
                                placeholder={get('rss_auth_keys.dialog.create.label_placeholder')} />
                        </FormItem>
                    </Form>
                </DialogContents>
            </Dialog>
        </TaskButton>
    );
}

function RssAuthKeyItem({ data, selected, onSelect, deletable }: { data: IRssAuthKey, selected?: boolean, onSelect?: () => void, deletable?: boolean }) {
    const [deleting, setDeleting] = useState(false);
    const runDelete = async () => {
        await load(RSS_AUTH_KEY_DELETE, { key: data.key });
        setDeleting(false);
    };

    return (
        <div class={'rss-auth-key-list-item' + (selected ? ' is-selected' : '')} onPointerDown={onSelect} onClick={onSelect}>
            <div class="item-contents">
                <div class="key-title">
                    {deletable && (
                        <button
                            class="key-delete"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                                e.stopPropagation();
                                setDeleting(true);
                            }}>

                            <Dialog
                                class="rss-auth-key-delete-dialog"
                                title={get('rss_auth_keys.dialog.delete.title')}
                                open={deleting}
                                onClose={() => setDeleting(false)}
                                destroy={<TaskButton run={async () => setDeleting(false)}>
                                    {get('rss_auth_keys.dialog.delete.cancel')}
                                </TaskButton>}
                                confirm={<TaskButton run={runDelete}>
                                    {get('rss_auth_keys.dialog.delete.confirm')}
                                </TaskButton>}>
                                <DialogContents>
                                    {get('rss_auth_keys.dialog.delete.description')}
                                    <RssAuthKeyItem data={data} />
                                </DialogContents>
                            </Dialog>
                        </button>
                    )}
                    <code class="key-code">{data.key}</code>
                </div>
                <div class="key-info">
                    {data.label}
                </div>
            </div>
        </div>
    );
}
