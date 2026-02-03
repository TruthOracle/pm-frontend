import {Center, Stack, TabList, TabPanel, TabPanels, Tabs} from '@chakra-ui/react'
import { useCantonWallet } from "@/contexts/CantonWalletContext";
import Activity from './Portfolio/Activity'

function Portfolio() {
  useCantonWallet(); // Only call for context if needed, but don't destructure account

  return (
    <>
    <Stack minHeight={"100vh"} width={"100%"} px={10} color={"white"}>
        {/* <Heading textAlign={"center"} style={{ fontFamily: "'JetBrains Mono'" }}>My Portfolio</Heading>  */}

                <Tabs variant='unstyled'>
                  <TabList>
                    {/* <Tab _selected={{ color: 'black', bg: 'white' }} style={{ fontFamily: "'JetBrains Mono'" }} className='rounded-md'>Activity</Tab> */}
                    {/* <Tab  _selected={{ color: 'black', bg: 'white' }} style={{ fontFamily: "'JetBrains Mono'" }} className='rounded-md'>Summary</Tab> */}
                  </TabList>
                  <TabPanels>
                    <TabPanel>
                    <Center>
                      <Activity/>
                    </Center>  
                    </TabPanel>
                    {/* <TabPanel>
                      <Summary/>
                    </TabPanel> */}
                  </TabPanels>
                </Tabs>
    </Stack>   
    </>
  )
}

export default Portfolio