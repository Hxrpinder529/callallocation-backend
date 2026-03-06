const supabase = require('./supabaseClient');
const { sendBatchEmails } = require('./emailService');

const allocationLogic = {
  // Check for existing jobs in database
  checkExistingJobs: async (calls) => {
    const newCalls = [];
    
    for (const call of calls) {
      const { data: existing } = await supabase
        .from('job_allocations')
        .select('job_no')
        .eq('job_no', call['Job No.'])
        .maybeSingle();
      
      if (!existing) {
        newCalls.push(call);
      }
    }
    
    return newCalls;
  },

  // Step 1: Same PIN code allocation (max 3 per ASC)
  step1SamePincode: (calls, network, allocatedCounts) => {
    const allocated = [];
    const remaining = [];
    
    for (const call of calls) {
      const customerPincode = call.Pincode?.toString().trim();
      if (!customerPincode) {
        remaining.push(call);
        continue;
      }
      
      // Find ASCs covering this pincode
      const coveringASCs = network.filter(asc => 
        asc.coverage_pincode?.toString().trim() === customerPincode
      );
      
      let allocatedThisCall = false;
      
      for (const asc of coveringASCs) {
        const currentCount = allocatedCounts[asc.id] || 0;
        if (currentCount < 3) {
          allocated.push({
            ...call,
            allocated_asc: asc,
            allocation_step: 1
          });
          allocatedCounts[asc.id] = currentCount + 1;
          allocatedThisCall = true;
          break;
        }
      }
      
      if (!allocatedThisCall) {
        remaining.push(call);
      }
    }
    
    return { allocated, remaining, allocatedCounts };
  },

  // Step 2: Check nearby pincodes from the 10 nearby columns
  step2NearbyPincode: (calls, network, allocatedCounts) => {
    const allocated = [];
    const remaining = [];
    
    for (const call of calls) {
      const customerPincode = call.Pincode?.toString().trim();
      if (!customerPincode) {
        remaining.push(call);
        continue;
      }
      
      // Find ASCs whose nearby pincodes match
      const nearbyASCs = network.filter(asc => {
        const nearbyPincodes = [
          asc.nearby_pincode1, asc.nearby_pincode2, asc.nearby_pincode3,
          asc.nearby_pincode4, asc.nearby_pincode5, asc.nearby_pincode6,
          asc.nearby_pincode7, asc.nearby_pincode8, asc.nearby_pincode9,
          asc.nearby_pincode10
        ].filter(p => p && p.toString().trim() !== '');
        
        return nearbyPincodes.some(p => p.toString().trim() === customerPincode);
      });
      
      let allocatedThisCall = false;
      
      for (const asc of nearbyASCs) {
        const currentCount = allocatedCounts[asc.id] || 0;
        if (currentCount < 3) {
          allocated.push({
            ...call,
            allocated_asc: asc,
            allocation_step: 2
          });
          allocatedCounts[asc.id] = currentCount + 1;
          allocatedThisCall = true;
          break;
        }
      }
      
      if (!allocatedThisCall) {
        remaining.push(call);
      }
    }
    
    return { allocated, remaining, allocatedCounts };
  },

  // Step 3: Same city ASC
  step3SameCity: (calls, network, allocatedCounts) => {
    const allocated = [];
    const remaining = [];
    
    for (const call of calls) {
      const customerCity = call.City?.toString().trim();
      if (!customerCity) {
        remaining.push(call);
        continue;
      }
      
      const cityASCs = network.filter(asc => 
        asc.city?.toString().trim().toLowerCase() === customerCity.toLowerCase()
      );
      
      let allocatedThisCall = false;
      
      for (const asc of cityASCs) {
        const currentCount = allocatedCounts[asc.id] || 0;
        if (currentCount < 3) {
          allocated.push({
            ...call,
            allocated_asc: asc,
            allocation_step: 3
          });
          allocatedCounts[asc.id] = currentCount + 1;
          allocatedThisCall = true;
          break;
        }
      }
      
      if (!allocatedThisCall) {
        remaining.push(call);
      }
    }
    
    return { allocated, remaining, allocatedCounts };
  },

  // 🆕 Step 4: Same state ASC (if no city match)
  step4SameState: (calls, network, allocatedCounts) => {
    const allocated = [];
    const remaining = [];
    
    for (const call of calls) {
      const customerState = call.State?.toString().trim();
      if (!customerState) {
        remaining.push(call);
        continue;
      }
      
      const stateASCs = network.filter(asc => 
        asc.state?.toString().trim().toLowerCase() === customerState.toLowerCase()
      );
      
      let allocatedThisCall = false;
      
      for (const asc of stateASCs) {
        const currentCount = allocatedCounts[asc.id] || 0;
        if (currentCount < 3) {
          allocated.push({
            ...call,
            allocated_asc: asc,
            allocation_step: 4
          });
          allocatedCounts[asc.id] = currentCount + 1;
          allocatedThisCall = true;
          break;
        }
      }
      
      if (!allocatedThisCall) {
        remaining.push(call);
      }
    }
    
    return { allocated, remaining, allocatedCounts };
  },

  // Main allocation function
  allocateCalls: async (callsData, networkData, fileName) => {
    try {
      // Filter only "Registered-Registered" and blank remark
      const pendingCalls = callsData.filter(call => 
        call['Job Status'] === 'Registered-Registered' && 
        (!call.Remark || call.Remark.toString().trim() === '')
      );
      
      console.log(`Found ${pendingCalls.length} pending calls`);
      
      // Check for existing jobs in database
      const newCalls = await allocationLogic.checkExistingJobs(pendingCalls);
      console.log(`${newCalls.length} new calls to allocate`);
      
      // Initialize allocation counters
      let allocatedCounts = {};
      let allAllocated = [];
      let unallocated = newCalls;
      
      // Execute allocation steps in sequence
      
      // Step 1
      const step1 = allocationLogic.step1SamePincode(unallocated, networkData, allocatedCounts);
      allAllocated = [...allAllocated, ...step1.allocated];
      unallocated = step1.remaining;
      allocatedCounts = step1.allocatedCounts;
      
      console.log(`Step 1 allocated: ${step1.allocated.length}`);
      
      // Step 2
      const step2 = allocationLogic.step2NearbyPincode(unallocated, networkData, allocatedCounts);
      allAllocated = [...allAllocated, ...step2.allocated];
      unallocated = step2.remaining;
      allocatedCounts = step2.allocatedCounts;
      
      console.log(`Step 2 allocated: ${step2.allocated.length}`);
      
      // Step 3
      const step3 = allocationLogic.step3SameCity(unallocated, networkData, allocatedCounts);
      allAllocated = [...allAllocated, ...step3.allocated];
      unallocated = step3.remaining;
      allocatedCounts = step3.allocatedCounts;
      
      console.log(`Step 3 allocated: ${step3.allocated.length}`);
      
      // Step 4: Same State
      const step4 = allocationLogic.step4SameState(unallocated, networkData, allocatedCounts);
      allAllocated = [...allAllocated, ...step4.allocated];
      unallocated = step4.remaining;
      
      console.log(`Step 4 allocated: ${step4.allocated.length}`);
      
      // Save allocations to database
      for (const item of allAllocated) {
        const jobData = {
          job_no: item['Job No.'],
          serialno: item.SERIALNO,
          customer_name: item['Customer Name'],
          contact_no: item['Contact No.'],
          address: item.Address,
          pincode: item.Pincode,
          product: item.Product,
          brand: item.Brand,
          model: item.Model,
          job_for: item['Job For'],
          job_status: item['Job Status'],
          remark: item.Remark,
          allocated_asc_id: item.allocated_asc.id,
          allocated_asc_name: item.allocated_asc.asp_name,
          allocation_status: 'allocated',
          allocation_date: new Date(),
          email_sent_status: false,
          file_name: fileName
        };
        
        await supabase
          .from('job_allocations')
          .insert(jobData)
          .select();
          
        // Add to history
        await supabase
          .from('allocation_history')
          .insert({
            job_no: item['Job No.'],
            asc_id: item.allocated_asc.id,
            asc_name: item.allocated_asc.asp_name,
            allocation_step: item.allocation_step,
            file_name: fileName
          });
      }
      
      // 🆕 Send emails for allocated calls
      console.log(`\n📧 Sending emails for ${allAllocated.length} allocated calls...`);
      let emailResults = { successful: 0, failed: 0 };
      
      if (allAllocated.length > 0) {
        emailResults = await sendBatchEmails(allAllocated);
      } else {
        console.log('No allocations to send emails for');
      }
      
      return {
        success: true,
        allocated: allAllocated,
        unallocated: unallocated,
        emailResults: emailResults, // 🆕 Include email results
        summary: {
          total: pendingCalls.length,
          new_calls: newCalls.length,
          allocated: allAllocated.length,
          unallocated: unallocated.length,
          step1: step1.allocated.length,
          step2: step2.allocated.length,
          step3: step3.allocated.length,
          step4: step4.allocated.length,
          emails_sent: emailResults.successful,
          emails_failed: emailResults.failed
        }
      };
      
    } catch (error) {
      console.error('Allocation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = allocationLogic;