import React from 'react';
import { Box, Text } from 'ink';

interface EndpointDisplayProps {
  baseURL?: string;
}

export const EndpointDisplay: React.FC<EndpointDisplayProps> = ({
  baseURL,
}) => (
  <Box>
    <Text>{baseURL}</Text>
  </Box>
);
