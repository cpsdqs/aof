import { h, Component } from 'preact';
import { useState } from 'preact/compat';
import { Checkbox, TaskButton, TextField } from 'uikit';
import { ItemList, ItemListSection, ItemListItem } from '../../components/item-list';
import LocalePicker from '../../components/locale-picker';
import get from '../../locale';
import { PageProps } from '../../router';
import {
    load,
    LOGIN,
    LOGIN_CHANGE_NAME,
    LOGIN_CHANGE_PASSWORD,
    LOGIN_DELETE_ACCOUNT
} from '../../data';
import { cache } from '../../data/cache';
import Dialog, { DialogContents } from '../../components/dialog';
import { Form, FormDescription, FormFooter, FormItem } from '../../components/form';

export default function SettingsPage(this: Component, { route }: PageProps) {
    const [dialog, setDialog] = useState<string | null>(null);
    const onDialogClose = () => setDialog(null);

    return (
        <div class="settings-page">
            <ItemListSection label={get('pages.settings.device')} />
            <ItemList>
                <ItemListItem
                    label={get('pages.settings.locale')}
                    trailing={<LocalePicker />} />
                <ItemListItem
                    label={get('pages.settings.dev_mode')}
                    trailing={<Checkbox
                        checked={!!localStorage.aof_dev_mode}
                        onChange={checked => {
                            if (checked) localStorage.aof_dev_mode = '1';
                            else delete localStorage.aof_dev_mode;
                            this.forceUpdate();
                        }} />} />
            </ItemList>
            <ItemListSection label={get('pages.settings.account')} />
            <ItemList>
                <ItemListItem label={get('pages.settings.view_data')} />
                <ItemListItem
                    onSelect={() => setDialog('change_name')}
                    label={get('pages.settings.change_name')} />
                <ItemListItem
                    onSelect={() => setDialog('change_password')}
                    label={get('pages.settings.change_password')} />
                <ItemListItem
                    onSelect={() => setDialog('change_sk_password')}
                    label={get('pages.settings.change_sk_password')} />
                <ItemListItem
                    onSelect={() => setDialog('delete_account')}
                    label={get('pages.settings.delete_account')} />
            </ItemList>
            {localStorage.aof_dev_mode && (
                <ItemList>
                    <ItemListItem
                        selected={route.__debug}
                        onSelect={() => this.context.navigate('settings/debug')}
                        label={'Debug'} />
                </ItemList>
            )}

            <Dialog
                open={dialog === 'change_name'}
                title={get('pages.settings.change_name')}
                onClose={onDialogClose}>
                <ChangeName onClose={onDialogClose} />
            </Dialog>
            <Dialog
                open={dialog === 'change_password'}
                title={get('pages.settings.change_password')}
                onClose={onDialogClose}>
                <ChangePassword onClose={onDialogClose} />
            </Dialog>
            <Dialog
                open={dialog === 'delete_account'}
                title={get('pages.settings.delete_account')}
                onClose={onDialogClose}>
                <DeleteAccount onClose={onDialogClose} />
            </Dialog>
        </div>
    )
}

function ChangeName({ onClose }: { onClose: () => void }) {
    const [name, setName] = useState(cache.get(LOGIN)!);

    const run = async () => {
        await load(LOGIN_CHANGE_NAME, { name });
        onClose();
    };

    return (
        <Form>
            <FormItem stack label={get('pages.settings.fields.name')}>
                <TextField value={name} onChange={setName} />
            </FormItem>
            <FormFooter>
                <TaskButton run={async () => onClose()}>
                    {get('pages.settings.buttons.cancel')}
                </TaskButton>
                <TaskButton run={run}>
                    {get('pages.settings.buttons.change_name')}
                </TaskButton>
            </FormFooter>
        </Form>
    );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
    const [pw, setPw] = useState('');
    const [cpw, setCpw] = useState('');
    const [opw, setOpw] = useState('');

    const run = async () => {
        if (pw !== cpw) throw new Error(get('pages.settings.fields.password_mismatch'));

        await load(LOGIN_CHANGE_PASSWORD, {
            password: opw,
            new_password: pw,
        });
        onClose();
    };

    return (
        <Form>
            <FormDescription>
                {get('pages.settings.fields.change_password_desc')}
            </FormDescription>
            <FormItem stack label={get('pages.settings.fields.password')}>
                <TextField type="password" value={pw} onChange={setPw} />
            </FormItem>
            <FormItem stack label={get('pages.settings.fields.confirm_password')}>
                <TextField type="password" value={cpw} onChange={setCpw} />
            </FormItem>
            <FormItem stack label={get('pages.settings.fields.old_password')}>
                <TextField type="password" value={opw} onChange={setOpw} />
            </FormItem>
            <FormFooter>
                <TaskButton run={async () => onClose()}>
                    {get('pages.settings.buttons.cancel')}
                </TaskButton>
                <TaskButton run={run}>
                    {get('pages.settings.buttons.change_password')}
                </TaskButton>
            </FormFooter>
        </Form>
    );
}

function DeleteAccount({ onClose }: { onClose: () => void }) {
    const [pw, setPw] = useState('');

    const run = async () => {
        await load(LOGIN_DELETE_ACCOUNT, { password: pw });
        onClose();
    };

    return (
        <Form>
            <FormDescription>
                {get('pages.settings.fields.delete_account_desc')}
            </FormDescription>
            <FormItem
                stack
                label={get('pages.settings.fields.delete_password')}>
                <TextField type="password" value={pw} onChange={setPw} />
            </FormItem>
            <FormFooter>
                <TaskButton run={async () => onClose()}>
                    {get('pages.settings.buttons.cancel')}
                </TaskButton>
                <TaskButton run={run}>
                    {get('pages.settings.buttons.delete_account')}
                </TaskButton>
            </FormFooter>
        </Form>
    );
}
