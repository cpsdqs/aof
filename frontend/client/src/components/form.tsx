import { h, ComponentChildren } from 'preact';
import { PureComponent } from 'preact/compat';
import './form.less';

export class Form extends PureComponent<Form.Props> {
    render({ children }: Form.Props) {
        return (
            <div class="form-container">
                {children}
            </div>
        );
    }
}

namespace Form {
    export interface Props {
        children: ComponentChildren,
    }
}

export class FormItem extends PureComponent<FormItem.Props> {
    render({ stack, label, description, children }: FormItem.Props) {
        let className = 'form-item';
        if (stack) className += ' is-stacked';

        let desc = null;
        if (description) {
            desc = (
                <div class="item-description">
                    {description}
                </div>
            );
        }

        return (
            <div class={className}>
                <div class="item-inner">
                    <div class="item-label">
                        <label>{label}</label>
                    </div>
                    {stack && desc}
                    <div class="item-contents">
                        {children}
                    </div>
                </div>
                {!stack && desc}
            </div>
        );
    }
}

namespace FormItem {
    export interface Props {
        label: ComponentChildren,
        children: ComponentChildren,
        stack?: boolean,
        description?: ComponentChildren,
    }
}

export class FormDescription extends PureComponent<FormFooter.Props> {
    render({ children }: FormFooter.Props) {
        return (
            <div class="form-description">
                {children}
            </div>
        );
    }
}

namespace FormDescription {
    export interface Props {
        children: ComponentChildren,
    }
}

export class FormFooter extends PureComponent<FormFooter.Props> {
    render({ children }: FormFooter.Props) {
        return (
            <div class="form-footer">
                {children}
            </div>
        );
    }
}

namespace FormFooter {
    export interface Props {
        children: ComponentChildren,
    }
}
