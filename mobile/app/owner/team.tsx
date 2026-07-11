import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import {
  useDeactivateBusinessMember,
  useInviteBusinessMember,
  useUpdateBusinessMember,
} from '@/api/hooks/sessionHooks';
import { useTheme } from '@/lib/theme';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
import { useAuthStore, type BusinessMember } from '@/store/auth';
import type { MemberRole } from '@/types/business';

const INVITE_ROLES: Extract<MemberRole, 'manager' | 'staff'>[] = ['staff', 'manager'];

function displayName(member: BusinessMember) {
  return member.user_name || member.user_phone || 'Team member';
}

function roleLabel(role: string) {
  return role.replace(/_/g, ' ');
}

export default function TeamScreen() {
  const { colors, fonts } = useTheme();
  const members = useAuthStore((state) => state.members);
  const currentRole = useAuthStore((state) => state.role);
  const inviteMember = useInviteBusinessMember();
  const updateMember = useUpdateBusinessMember();
  const deactivateMember = useDeactivateBusinessMember();
  const [phone, setPhone] = useState('');
  const [inviteRole, setInviteRole] = useState<Extract<MemberRole, 'manager' | 'staff'>>('staff');

  const canManage = currentRole === 'owner' || currentRole === 'manager';
  const activeMembers = useMemo(
    () => [...members].sort((a, b) => Number(b.is_active) - Number(a.is_active) || roleLabel(a.role).localeCompare(roleLabel(b.role))),
    [members]
  );

  function handleInvite() {
    const trimmed = phone.trim();
    if (!trimmed || !canManage) return;
    inviteMember.mutate(
      { phone: trimmed, role: inviteRole },
      {
        onSuccess: () => setPhone(''),
        onError: (e: Error) => Alert.alert('Could not send invite', e.message ?? 'Please try again.'),
      }
    );
  }

  function handleRoleChange(member: BusinessMember, role: Extract<MemberRole, 'manager' | 'staff'>) {
    if (!canManage || member.role === 'owner') return;
    updateMember.mutate(
      { memberId: member.id, role },
      { onError: (e: Error) => Alert.alert('Could not update role', e.message ?? 'Please try again.') }
    );
  }

  function handleDeactivate(member: BusinessMember) {
    if (!canManage || member.role === 'owner') return;
    deactivateMember.mutate(member.id, {
      onError: (e: Error) => Alert.alert('Could not deactivate member', e.message ?? 'Please try again.'),
    });
  }

  const inviteDisabled = !canManage || !phone.trim() || inviteMember.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>
          Team & roles
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Invite staff, assign access, and deactivate people who should no longer use this business.
        </Text>
      </View>

      <PlanGatedScreen feature="team">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 10 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
            Invite by phone
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {INVITE_ROLES.map((role) => (
              <TouchableOpacity
                key={role}
                onPress={() => setInviteRole(role)}
                disabled={!canManage}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: inviteRole === role ? `${colors.brand}18` : `${colors.ink}08`,
                  borderWidth: 1,
                  borderColor: inviteRole === role ? colors.brand : colors.border,
                }}
              >
                <Text style={{ fontSize: 11.5, fontFamily: fonts.bodySemiBold, color: inviteRole === role ? colors.brand : colors.muted, textTransform: 'capitalize' }}>
                  {role}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="024 000 0000"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              style={{
                flex: 1,
                minHeight: 44,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                color: colors.ink,
                fontFamily: fonts.body,
              }}
            />
            <TouchableOpacity
              onPress={handleInvite}
              disabled={inviteDisabled}
              style={{
                minWidth: 86,
                borderRadius: 10,
                backgroundColor: colors.brand,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: inviteDisabled ? 0.55 : 1,
              }}
            >
              {inviteMember.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Invite</Text>
              )}
            </TouchableOpacity>
          </View>
          {!canManage ? (
            <Text style={{ fontSize: 11.5, color: colors.muted }}>
              Only owners and managers can invite or change team access.
            </Text>
          ) : null}
        </View>

        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
          {activeMembers.length === 0 ? (
            <View style={{ padding: 14 }}>
              <Text style={{ color: colors.muted }}>No team members found for this business.</Text>
            </View>
          ) : null}
          {activeMembers.map((member, index) => {
            const isOwner = member.role === 'owner';
            const canEditMember = canManage && !isOwner;
            return (
              <View
                key={member.id}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderBottomWidth: index < activeMembers.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  gap: 10,
                  opacity: member.is_active ? 1 : 0.55,
                }}
              >
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="account-outline" size={18} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                      {displayName(member)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {member.user_phone ?? 'No phone'} · {member.is_active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: isOwner ? `${colors.gold}18` : `${colors.brand}12` }}>
                    <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: isOwner ? colors.gold : colors.brand, textTransform: 'capitalize' }}>
                      {roleLabel(member.role)}
                    </Text>
                  </View>
                </View>

                {canEditMember ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {INVITE_ROLES.map((role) => (
                      <TouchableOpacity
                        key={role}
                        onPress={() => handleRoleChange(member, role)}
                        disabled={updateMember.isPending || member.role === role}
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: member.role === role ? `${colors.brand}15` : `${colors.ink}06`,
                          opacity: updateMember.isPending ? 0.55 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: member.role === role ? colors.brand : colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'capitalize' }}>
                          {role}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => handleDeactivate(member)}
                      disabled={deactivateMember.isPending}
                      style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: `${colors.danger}10`, opacity: deactivateMember.isPending ? 0.55 : 1 }}
                    >
                      <Text style={{ fontSize: 11, color: colors.danger, fontFamily: fonts.bodySemiBold }}>
                        Deactivate
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      </PlanGatedScreen>
    </SafeAreaView>
  );
}
