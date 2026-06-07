import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useChatHistory, useClearChatHistory, useProcessChatMessage } from '@/api/hooks/featureHooks';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
import { useTheme } from '@/lib/theme';
import { LANGUAGE_OPTIONS, useUIStore } from '@/store/ui';

type MsgKind = 'plain' | 'intent' | 'success' | 'card';

interface IntentPayload {
  title: string;
  items: Array<{ n: string; q?: number | string; p: number | string }>;
  total?: number | null;
  method?: string | null;
  action?: string;
}
interface SuccessPayload { title: string; sub: string; total?: number }
interface CardPayload { title: string; stock: number; low: number; msg: string }

interface Msg {
  id: string;
  who: 'me' | 'bot';
  t?: string;
  kind?: MsgKind;
  payload?: IntentPayload | SuccessPayload | CardPayload;
  time: string;
}

function timeNow() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ChatBubble({ msg, onConfirm }: { msg: Msg; onConfirm?: () => void }) {
  const { colors, fonts } = useTheme();
  const isMe = msg.who === 'me';

  if (msg.kind === 'intent') {
    const p = msg.payload as IntentPayload;
    return (
      <View style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
        <View style={{ maxWidth: '82%' }}>
          <View style={{
            padding: 10, borderRadius: 14, borderBottomLeftRadius: 4,
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
              Confirm action
            </Text>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink }}>{p.title}</Text>
            <View style={{ marginTop: 6, padding: 8, backgroundColor: `${colors.ink}06`, borderRadius: 8 }}>
              {p.items.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{r.q ? `${r.q} × ${r.n}` : r.n}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {typeof r.p === 'number' ? `GH₵ ${r.p.toFixed(2)}` : r.p}
                  </Text>
                </View>
              ))}
              {p.total ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold }}>Total</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>GH₵ {p.total.toFixed(2)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
              <TouchableOpacity onPress={onConfirm} style={{
                paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8,
                backgroundColor: colors.brand,
              }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: '#fff' }}>{p.action || 'Yes, record'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{
                paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8,
                borderWidth: 1, borderColor: colors.border,
              }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.muted }}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 3, marginLeft: 4 }}>{msg.time}</Text>
        </View>
      </View>
    );
  }

  if (msg.kind === 'success') {
    const p = msg.payload as SuccessPayload;
    return (
      <View style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
        <View style={{ maxWidth: '82%' }}>
          <View style={{
            padding: 10, borderRadius: 14, borderBottomLeftRadius: 4,
            backgroundColor: `${colors.brand}10`, borderWidth: 1, borderColor: `${colors.brand}30`,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="check" size={14} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.brand }}>{p.title}</Text>
              <Text style={{ fontSize: 11.5, color: colors.muted }}>{p.sub}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 3, marginLeft: 4 }}>{msg.time}</Text>
        </View>
      </View>
    );
  }

  if (msg.kind === 'card') {
    const p = msg.payload as CardPayload;
    return (
      <View style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
        <View style={{ maxWidth: '82%' }}>
          <View style={{
            padding: 10, borderRadius: 14, borderBottomLeftRadius: 4,
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 14, color: colors.ink }}>{p.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 24, color: '#b6831e' }}>{p.stock}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>units · low at {p.low}</Text>
            </View>
            <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 4 }}>{p.msg}</Text>
          </View>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 3, marginLeft: 4 }}>{msg.time}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
      <View style={{ maxWidth: '78%' }}>
        <View style={{
          paddingHorizontal: 12, paddingVertical: 8,
          borderRadius: 14,
          borderBottomRightRadius: isMe ? 4 : 14,
          borderBottomLeftRadius: isMe ? 14 : 4,
          backgroundColor: isMe ? colors.brand : colors.surface,
          borderWidth: isMe ? 0 : 1,
          borderColor: colors.border,
        }}>
          <Text style={{ fontSize: 13.5, lineHeight: 19, color: isMe ? '#fff' : colors.ink }}>{msg.t}</Text>
          <Text style={{ fontSize: 10, marginTop: 2, color: isMe ? 'rgba(255,255,255,0.7)' : colors.muted, textAlign: 'right' }}>{msg.time}</Text>
        </View>
      </View>
    </View>
  );
}

function TypingDots() {
  const { colors } = useTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 3), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 8 }}>
      <View style={{
        paddingHorizontal: 14, paddingVertical: 12,
        borderRadius: 14, borderBottomLeftRadius: 4,
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
        flexDirection: 'row', alignItems: 'center', gap: 5,
      }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: i <= step ? colors.ink : `${colors.ink}20`,
          }} />
        ))}
      </View>
    </View>
  );
}


const SUGGESTIONS: { label: string; icon: string; prompt: string }[] = [
  // Sales
  { label: 'Record a sale', icon: '🛒', prompt: 'I sold 5 tomatoes at 10 cedis' },
  { label: 'Daily report', icon: '📊', prompt: 'Show me today\'s sales report' },
  { label: 'Weekly summary', icon: '📅', prompt: 'What were my sales this week?' },
  { label: 'Best selling item', icon: '🏆', prompt: 'What is my best selling item this month?' },
  // Stock
  { label: 'Check stock', icon: '📦', prompt: 'How much rice do I have in stock?' },
  { label: 'Low stock alert', icon: '⚠️', prompt: 'What items are running low?' },
  { label: 'Restock forecast', icon: '🔄', prompt: 'What should I restock soon?' },
  // Finance
  { label: 'Who owes me?', icon: '💳', prompt: 'Who owes me money?' },
  { label: 'My credit score', icon: '⭐', prompt: 'What is my credit score?' },
  { label: 'Loan eligibility', icon: '🏦', prompt: 'How much can I borrow?' },
  { label: 'Improve score', icon: '📈', prompt: 'How do I improve my credit score?' },
  // Help
  { label: 'What can you do?', icon: '🤖', prompt: 'help' },
];

export default function AssistantScreen() {
  const { colors, fonts } = useTheme();
  const language = useUIStore((s) => s.language);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const processMessage = useProcessChatMessage();
  const clearHistory = useClearChatHistory();
  const { data: history } = useChatHistory();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const activeLang = LANGUAGE_OPTIONS.find((l) => l.code === language)?.label ?? 'English';

  // Load history once on mount — backend stores { role, text, ... } not { content }
  useEffect(() => {
    if (historyLoaded || !history || history.length === 0) return;
    const mapped: Msg[] = (history as Array<{ id?: string; role?: string; text?: string; content?: string; created_at?: string }>)
      .slice(-20)
      .map((m) => ({
        id: m.id ?? String(Math.random()),
        who: (m.role === 'user' ? 'me' : 'bot') as 'me' | 'bot',
        t: m.text ?? m.content ?? '',
        time: m.created_at ? new Date(m.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }) : '',
      }));
    if (mapped.length > 0) {
      setMsgs(mapped);
      setHistoryLoaded(true);
    }
  }, [history, historyLoaded]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [msgs]);

  async function toggleRecording() {
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (uri) await transcribeAudio(uri);
      } catch {
        setRecording(null);
      }
    } else {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          Alert.alert('Microphone access needed', 'Please allow microphone access in your device settings.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        setRecording(rec);
      } catch {
        Alert.alert('Could not start recording', 'Please try again.');
      }
    }
  }

  async function transcribeAudio(uri: string) {
    setIsTranscribing(true);
    try {
      const { apiClient } = await import('@/api/client');
      const form = new FormData();
      form.append('audio', { uri, name: 'voice.m4a', type: 'audio/m4a' } as unknown as Blob);
      form.append('language', language);
      const res = await apiClient.post<{ text: string }>('/api/v1/chat/voice', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.text?.trim()) {
        send(res.data.text.trim());
      }
    } catch {
      Alert.alert('Could not transcribe', 'Please try typing instead.');
    } finally {
      setIsTranscribing(false);
    }
  }

  async function send(text: string, selectedLanguage = language) {
    if (!text.trim()) return;
    const t = timeNow();
    setMsgs((m) => [...m, { id: `${Date.now()}-u`, who: 'me', t: text, time: t }]);
    setInput('');
    try {
      const response = await processMessage.mutateAsync({ language: selectedLanguage, message: text });
      setMsgs((m) => [...m, {
        id: `${Date.now()}-a`, who: 'bot',
        t: String(response.reply ?? response.message ?? 'I can help with that.'), time: timeNow(),
      }]);
    } catch (err) {
      const axiosErr = err as { response?: { status: number } };
      let errMsg = "I'm offline — your message is saved.";
      if (axiosErr?.response?.status === 401) {
        errMsg = 'Session expired. Please log in again.';
      } else if (axiosErr?.response?.status === 422) {
        errMsg = "I couldn't understand that. Try rephrasing.";
      } else if (axiosErr?.response?.status && axiosErr.response.status >= 500) {
        errMsg = 'Server error. Try again shortly.';
      }
      setMsgs((m) => [...m, {
        id: `${Date.now()}-off`, who: 'bot', t: errMsg, time: timeNow(),
      }]);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 12, paddingVertical: 8,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Yɛ</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Yɛnsɛm Assistant</Text>
              <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${colors.brand}15` }}>
                <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: colors.brand }}>Online</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted }}>{activeLang}</Text>
          </View>
          <TouchableOpacity onPress={() => setShowLangPicker(true)} hitSlop={8} style={{ padding: 4 }}>
            <MaterialCommunityIcons name="translate" size={20} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={8}
            style={{ padding: 4 }}
            onPress={() => {
              Alert.alert(
                'Clear history?',
                'This will permanently delete your conversation history.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () =>
                      clearHistory.mutate(undefined, {
                        onSuccess: () => setMsgs([]),
                        onError: (e: Error) =>
                          Alert.alert('Error', e.message ?? 'Could not clear history.'),
                      }),
                  },
                ]
              );
            }}
          >
            <MaterialCommunityIcons name="delete-outline" size={20} color={colors.muted} />
          </TouchableOpacity>
        </View>

        <PlanGatedScreen feature="assistant">
        {/* Language picker modal */}
        <Modal visible={showLangPicker} transparent animationType="fade">
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setShowLangPicker(false)}>
            <Pressable style={{ backgroundColor: colors.surface, borderRadius: 16, width: 260, overflow: 'hidden' }} onPress={() => {}}>
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                Choose language
              </Text>
              {LANGUAGE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.code}
                  onPress={() => {
                    setLanguage(opt.code);
                    setShowLangPicker(false);
                    void send(`language ${opt.code}`, opt.code);
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 13,
                    borderBottomWidth: 1, borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 13.5, color: colors.ink, fontFamily: language === opt.code ? fonts.bodySemiBold : fonts.body }}>
                    {opt.label}
                  </Text>
                  {language === opt.code && (
                    <MaterialCommunityIcons name="check" size={16} color={colors.brand} />
                  )}
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Messages — dot-grid background */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12 }}
        >
          {msgs.length === 0 && !processMessage.isPending && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22 }}>Yɛ</Text>
              </View>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink }}>Maakye! Ɛte sɛn?</Text>
              <Text style={{ fontSize: 12.5, color: colors.muted, textAlign: 'center', maxWidth: 260 }}>
                I can help record sales, check stock levels, or answer questions about your business.
              </Text>
            </View>
          )}
          {msgs.map((m) => <ChatBubble key={m.id} msg={m} />)}
          {processMessage.isPending && <TypingDots />}
        </ScrollView>

        {/* Suggested chips */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6, gap: 6, alignItems: 'center' }}
        >
          {SUGGESTIONS.map((s) => (
            <TouchableOpacity key={s.prompt} onPress={() => send(s.prompt)} style={{
              paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'center', gap: 4,
            }}>
              <Text style={{ fontSize: 12 }}>{s.icon}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.bodySemiBold, color: colors.muted }}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input row */}
        <View style={{
          paddingHorizontal: 10, paddingBottom: 14, paddingTop: 8,
          flexDirection: 'row', alignItems: 'center', gap: 6,
          backgroundColor: colors.bg,
        }}>
          <View style={{
            flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: 999, height: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
          }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              placeholder={recording ? 'Recording… tap mic to stop' : 'Try "stock check" or speak…'}
              placeholderTextColor={recording ? colors.danger : colors.muted}
              style={{ flex: 1, fontSize: 13.5, color: colors.ink, fontFamily: fonts.body }}
            />
            <TouchableOpacity onPress={() => void toggleRecording()} disabled={isTranscribing} hitSlop={6}>
              {isTranscribing
                ? <ActivityIndicator size="small" color={colors.brand} />
                : <MaterialCommunityIcons
                    name={recording ? 'microphone' : 'microphone-outline'}
                    size={16}
                    color={recording ? colors.danger : colors.muted}
                  />
              }
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => send(input)} style={{
            width: 38, height: 38, borderRadius: 999,
            backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        </PlanGatedScreen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
