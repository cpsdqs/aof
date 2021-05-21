import { h } from 'preact';
import { useState, useRef, useEffect, PureComponent } from 'preact/compat';
import { Checkbox, TaskButton, TextField } from 'uikit';
import { RssIcon } from './icons';
import RssAuthKeys from './rss-auth-keys';
import { api, IRssAuthKey, parseUri } from '../data';
import Dialog, { DialogContents } from './dialog';
import get from '../locale';
import { Form, FormDescription, FormItem } from './form';
import './source-rss.less';

export default class SourceRss extends PureComponent<SourceRss.Props> {
    state = {
        currentKey: null as IRssAuthKey | null,
        pickingKey: false,
        showingFeed: false,
    };

    onBegin = async () => {
        this.setState({
            currentKey: null,
            pickingKey: true,
        });
    };

    onSelectKey = (key: IRssAuthKey) => {
        this.setState({
            currentKey: key,
            pickingKey: false,
            showingFeed: true,
        });
    };

    render() {
        return (
            <TaskButton class="source-rss" run={this.onBegin}>
                <RssIcon />

                <RssAuthKeys
                    open={this.state.pickingKey}
                    onSelect={this.onSelectKey}
                    onClose={() => this.setState({ pickingKey: false })} />

                <Dialog
                    class="source-rss-feed-link-dialog"
                    title={get('sources.rss.feed_link.title')}
                    open={this.state.showingFeed}
                    onClose={() => this.setState({ showingFeed: false })}
                    confirm={<TaskButton run={async () => this.setState({ showingFeed: false })}>
                        {get('sources.rss.feed_link.done')}
                    </TaskButton>}>
                    <RssFeedLink uri={this.props.uri} authKey={this.state.currentKey?.key} />
                </Dialog>
            </TaskButton>
        );
    }
}
namespace SourceRss {
    export interface Props {
        uri: string,
    }
}

function RssFeedLink({ uri, authKey }: { uri: string, authKey?: string }) {
    if (!authKey) return null;

    const [limit, setLimit] = useState(20);
    const [useCamo, setUseCamo] = useState(true);
    const linkField = useRef<TextField>();

    let params = [];
    if (limit !== 20) params.push('limit=' + limit);
    if (!useCamo) params.push('camo=false');

    let p = params.length ? ('?' + params.join('&')) : '';
    const link = new URL(api(`rss/${authKey}/source/${parseUri(uri).join('/')}` + p), document.location.href).toString();

    useEffect(() => {
        if (linkField.current?.input.current) {
            linkField.current.input.current.scrollLeft = 9999;
        }
    });

    return (
        <DialogContents>
            <Form>
                <FormItem stack label={get('sources.rss.feed_link.limit')}>
                    <TextField
                        type="number"
                        value={'' + limit}
                        onChange={v => Number.isFinite(+v) && setLimit(+v)} />
                </FormItem>
                <FormItem label={get('sources.rss.feed_link.use_camo')}>
                    <Checkbox
                        checked={useCamo}
                        onChange={setUseCamo} />
                </FormItem>
                <FormItem stack label={get('sources.rss.feed_link.link')}>
                    <TextField
                        ref={linkField}
                        value={link}
                        onFocus={e => e.target.select()}
                        onClick={(e: MouseEvent) => {
                            const input = e.target! as HTMLInputElement;
                            setTimeout(() => {
                                input.select();
                            }, 100);
                        }}
                        onKeyDown={e => {
                            if (e.ctrlKey || e.altKey || e.metaKey) return;
                            e.preventDefault();
                        }}
                        onChange={() => {}} />
                </FormItem>
                <FormDescription>
                    <div class="open-in-reader-button-container">
                        <TaskButton class="open-in-reader-button" run={async () => {
                            const a = document.createElement('a');
                            a.href = link;
                            a.target = '_blank';
                            a.rel = 'nofollow noreferrer';
                            a.click();
                        }}>
                            {get('sources.rss.feed_link.open')}
                        </TaskButton>
                    </div>
                </FormDescription>
            </Form>
        </DialogContents>
    );
}
