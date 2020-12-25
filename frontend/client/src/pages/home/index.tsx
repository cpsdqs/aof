import { h, Component } from 'preact';
import UserCard from './user-card';
import { ItemList, ItemListItem } from '../../components/item-list';
import get from '../../locale';
import { PageProps } from '../../router';

export default function HomePage(this: Component, { route }: PageProps) {
    return (
        <div class="home-page">
            <UserCard />
            <ItemList>
                <ItemListItem
                    selected={route.sources}
                    onSelect={() => this.context.navigate('sources')}
                    label={get('pages.sources.title')}  />
                <ItemListItem
                    selected={route.domains}
                    onSelect={() => this.context.navigate('domains')}
                    label={get('pages.domains.title')}  />
            </ItemList>
            <ItemList>
                <ItemListItem
                    selected={route.settings}
                    onSelect={() => this.context.navigate('settings')}
                    label={get('pages.settings.title')}  />
            </ItemList>
        </div>
    )
}
