/**
 * An image file on the session's machine, read over the session RPC
 * (useSessionImage). Fills the box given in `style`: a spinner while it loads,
 * the image once read, or why it can't be shown (tap to retry a failed read).
 */
import * as React from 'react';
import { ActivityIndicator, Image, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useSessionImage } from '@/hooks/useSessionImage';
import { formatImageSize } from '@/utils/sessionImage';
import { t } from '@/text';

export const SessionImage = React.memo((props: {
    sessionId: string;
    /** Absolute, or relative to the session root. */
    path: string;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    /** Called when the loaded image is tapped. */
    onPress?: () => void;
}) => {
    const { theme } = useUnistyles();
    const { uri, loading, error, retry } = useSessionImage(props.sessionId, props.path);

    return (
        <View style={[styles.box, props.style]}>
            {uri ? (
                <Pressable style={styles.fill} onPress={props.onPress} disabled={!props.onPress}>
                    <Image
                        source={{ uri }}
                        style={styles.fill}
                        resizeMode="contain"
                        accessibilityLabel={props.accessibilityLabel}
                    />
                </Pressable>
            ) : loading ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : error ? (
                <Pressable style={styles.message} onPress={retry}>
                    <Ionicons name="image-outline" size={24} color={theme.colors.textSecondary} />
                    <Text style={styles.messageText}>
                        {error.kind === 'tooLarge'
                            ? t('files.imageTooLarge', { size: formatImageSize(error.size) })
                            : t('files.imageLoadFailed')}
                    </Text>
                    {error.kind === 'failed' && error.message ? (
                        <Text style={styles.detailText} numberOfLines={3}>{error.message}</Text>
                    ) : null}
                    {error.kind === 'failed' ? (
                        <Text style={styles.retryText}>{t('common.retry')}</Text>
                    ) : null}
                </Pressable>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    box: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    fill: {
        width: '100%',
        height: '100%',
    },
    message: {
        alignItems: 'center',
        gap: 4,
        padding: 16,
    },
    messageText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    detailText: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    retryText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textLink,
    },
}));
