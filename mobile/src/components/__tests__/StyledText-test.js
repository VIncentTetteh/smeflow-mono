import * as React from 'react';
import { act, create } from 'react-test-renderer';

import { MonoText } from '../StyledText';

it(`renders correctly`, async () => {
  let tree;
  await act(async () => {
    tree = create(<MonoText>Snapshot test!</MonoText>);
  });
  expect(tree.toJSON()).toMatchSnapshot();
});
