import {Box, Center} from '@chakra-ui/react'
import AdminForm from './AdminForm'

type Props = {}

function Admin({}: Props) {
  return (
    <>
    <Box maxHeight={"100vh"} width={"100%"} pt={20} px={20}>
        {/* <h1>Admin</h1> */}
        {/* <p>Voting Functionality</p> */}
        {/* <Flex> */}
        <Center>
            <h1 className='font-jbm text-white font-bold text-2xl'>Build your own Prediction Market</h1>
        </Center>
        <Center mt={10}>
                                
    
                    <AdminForm/>

        </Center>
        {/* <Box my ={20} mx={10}>  
        <Center>
                <h1 className='font-jbm text-white font-bold text-2xl'>Approve data from oracles</h1>

        </Center>      
            <VoteTable/>
        </Box>
         */}
    </Box>
    </>
  )
}

export default Admin