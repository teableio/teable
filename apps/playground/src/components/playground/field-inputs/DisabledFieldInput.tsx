import { AlertCircle, FileIcon, User, Zap } from 'lucide-react';
import type { FieldInputProps } from './types';

export function DisabledFieldInput({ field }: FieldInputProps) {
  const fieldType = field.type().toString();

  let icon: React.ReactNode;
  let message: string;

  switch (fieldType) {
    case 'attachment':
      icon = <FileIcon className="h-4 w-4" />;
      message = 'Attachment upload is not yet supported';
      break;
    case 'user':
    case 'createdBy':
    case 'lastModifiedBy':
      icon = <User className="h-4 w-4" />;
      message = 'User selection is not yet supported';
      break;
    case 'button':
      icon = <Zap className="h-4 w-4" />;
      message = 'Button fields cannot be edited';
      break;
    default:
      icon = <AlertCircle className="h-4 w-4" />;
      message = 'This field type is not yet supported';
  }

  return (
    <div className="flex items-center gap-2 p-3 rounded-md border border-dashed bg-muted/50 text-muted-foreground">
      {icon}
      <span className="text-sm">{message}</span>
    </div>
  );
}
