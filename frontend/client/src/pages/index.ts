import { VNode } from 'preact';
import debug from './debug';
import domains from './domains';
import domain from './domains/domain';
import error from './error';
import home from './home';
import sources from './sources';
import source from './sources/source';
import source_item from './sources/source/item';
import settings from './settings';
import { PageProps } from '../router';

export default {
    debug,
    domains,
    domain,
    error,
    home,
    sources,
    source,
    source_item,
    settings,
} as unknown as { [k: string]: ((p: PageProps) => VNode) }; // pretend everything exists
