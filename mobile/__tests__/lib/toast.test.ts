import { useToastStore, toast } from '../../src/lib/toast';

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ message: '', tone: 'success', visible: false });
  });

  it('shows a success toast', () => {
    toast.success('Sale recorded');
    const state = useToastStore.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('Sale recorded');
    expect(state.tone).toBe('success');
  });

  it('shows an error toast', () => {
    toast.error('Something went wrong');
    const state = useToastStore.getState();
    expect(state.visible).toBe(true);
    expect(state.tone).toBe('error');
  });

  it('hides the toast', () => {
    toast.success('test');
    useToastStore.getState().hide();
    expect(useToastStore.getState().visible).toBe(false);
  });
});
