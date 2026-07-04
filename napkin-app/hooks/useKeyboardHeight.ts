/**
 * useKeyboardHeight — current soft-keyboard height in pts (0 when hidden).
 *
 * iOS subscribes to the Will* events so consumers can resize in step with the
 * keyboard animation; Android only emits Did*.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (e) => {
            setHeight(e.endCoordinates?.height ?? 0);
        });
        const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    return height;
}
