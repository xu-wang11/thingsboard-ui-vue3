import { message, Modal } from 'ant-design-vue';

type MessageType = 'error' | 'info' | 'success' | 'warn' | 'warning';

export function useMessage() {
  return {
    createConfirm: Modal.confirm,
    showMessage(content: string, type: MessageType = 'success') {
      const method = type === 'warn' ? 'warning' : type;
      message[method](content);
    },
  };
}
