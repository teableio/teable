import { CommentNodeType } from '@teable/openapi';
import type { ICommentContent } from '@teable/openapi';
import type { TElement, TDescendant } from '@udecode/plate-common';
import { size, has } from 'lodash';

export const hasOnlyProperty = (obj: Record<string, unknown>, propertyName: string) => {
  return size(obj) === 1 && has(obj, propertyName);
};

export const isTextCommentNode = (element: TDescendant) => {
  return hasOnlyProperty(element, 'text') && !!element.text;
};

export class EditorTransform {
  static editorValue2CommentValue = (value: TElement[]): ICommentContent => {
    if (
      !value ||
      (value.length === 1 && value[0]?.children.length === 1 && !value[0].children[0].text)
    ) {
      return [] as ICommentContent;
    }

    return value.map((element) => {
      if (element.type === CommentNodeType.Img) {
        return {
          type: CommentNodeType.Img,
          path: element.path,
          width: element.width,
        };
      } else {
        return {
          type: CommentNodeType.Paragraph,
          children: element.children
            .filter((chi) => {
              return chi.text || chi.type;
            })
            .map((child) => {
              if (isTextCommentNode(child)) {
                return {
                  value: child.text,
                  type: CommentNodeType.Text,
                };
              }
              if (child.type === CommentNodeType.Mention) {
                return {
                  type: CommentNodeType.Mention,
                  value: child.value,
                };
              }

              if (child.type === CommentNodeType.Img) {
                return {
                  type: CommentNodeType.Img,
                  path: child.path,
                  width: child.width,
                };
              }

              if (child.type === CommentNodeType.Link) {
                return {
                  type: CommentNodeType.Link,
                  url: child.url,
                  title: (child as TElement)?.children?.[0].text || '',
                };
              }
            }),
        };
      }
    }) as ICommentContent;
  };

  static commentValue2EditorValue = (value: ICommentContent): TElement[] => {
    return value.map((element) => {
      const { type: lineType } = element;
      if (lineType === CommentNodeType.Img) {
        return {
          type: CommentNodeType.Img,
          path: element.path,
          width: element.width,
          children: [{ text: '' }],
        } as TElement;
      } else {
        return {
          type: 'p',
          children: element.children.map((child) => {
            switch (child.type) {
              case CommentNodeType.Text: {
                return {
                  text: child.value,
                };
              }
              case CommentNodeType.Mention: {
                return {
                  value: child.value,
                  children: [{ text: '' }],
                  type: CommentNodeType.Mention,
                };
              }
              case CommentNodeType.Link: {
                return {
                  type: CommentNodeType.Link,
                  url: child.url,
                  children: [{ text: child.title }],
                };
              }
            }
          }),
        } as TElement;
      }
    });
  };
}
