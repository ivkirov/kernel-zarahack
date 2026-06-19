package com.zarahack.timepoverty.repository;

import com.zarahack.timepoverty.entity.DemographicWeight;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DemographicWeightRepository extends JpaRepository<DemographicWeight, Long> {
    List<DemographicWeight> findByDistrict(String district);
}
